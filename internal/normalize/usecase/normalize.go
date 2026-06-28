// Package usecase holds the normalize business logic: read a source's raw
// parsed_services rows, bind them to the catalog, and publish normalized offers
// into the gold table the API reads.
package usecase

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"

	ndomain "medprice/internal/normalize/domain"
	"medprice/pkg/rabbitmq"
)

// Real service names are short; longer strings are crawler mis-extractions
// (descriptions) and must not become catalog entries (catalog name_norm is varchar(255)).
const maxCatalogNameLen = 200
const llmCandidateLimit = 5
const minLLMCandidateSimilarity = 0.38

type Options struct {
	MaxLLMCallsPerSource int
	SourceWorkers        int
}

type Service struct {
	repo                 ndomain.Repository
	llm                  ndomain.LLMMatcher // optional; nil = LLM fallback disabled
	log                  rabbitmq.Logger
	maxLLMCallsPerSource int
	sourceWorkers        int
	inflight             sync.Map
}

// truncRunes caps a string to n runes (safe for varchar limits + Cyrillic).
func truncRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

type TaskMeta struct {
	MsgID       string
	AdapterID   string
	RowsWritten int
	ParsedAt    time.Time
	Trigger     string
}

// NewService wires the normalize usecase. llm may be nil (deterministic matching only).
func NewService(repo ndomain.Repository, llm ndomain.LLMMatcher, log rabbitmq.Logger, opts ...Options) *Service {
	cfg := Options{MaxLLMCallsPerSource: 80, SourceWorkers: 1}
	if len(opts) > 0 {
		cfg = opts[0]
	}
	if cfg.SourceWorkers <= 0 {
		cfg.SourceWorkers = 1
	}
	return &Service{
		repo:                 repo,
		llm:                  llm,
		log:                  log,
		maxLLMCallsPerSource: cfg.MaxLLMCallsPerSource,
		sourceWorkers:        cfg.SourceWorkers,
	}
}

func (s *Service) ProcessPending(ctx context.Context, limit int) (int, error) {
	ids, err := s.repo.PendingSourceIDs(ctx, limit)
	if err != nil {
		return 0, errors.Wrap(err, "load pending sources")
	}
	if len(ids) == 0 {
		s.log.Info("normalize sweep no pending sources")
		return 0, nil
	}
	s.log.Info("normalize sweep found pending sources", "count", len(ids))

	if s.sourceWorkers > 1 && len(ids) > 1 {
		return s.processPendingParallel(ctx, ids)
	}

	for i, sourceID := range ids {
		processed, err := s.TryProcessSource(ctx, sourceID, TaskMeta{Trigger: "sweep"})
		if !processed {
			continue
		}
		if err != nil {
			return i, errors.Wrap(err, "normalize pending source")
		}
	}
	return len(ids), nil
}

func (s *Service) processPendingParallel(ctx context.Context, ids []uuid.UUID) (int, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan uuid.UUID)
	errCh := make(chan error, 1)
	var wg sync.WaitGroup
	var mu sync.Mutex
	processed := 0

	workers := s.sourceWorkers
	if workers > len(ids) {
		workers = len(ids)
	}
	s.log.Info("normalize sweep worker pool started", "workers", workers, "sources", len(ids))

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for sourceID := range jobs {
				if ctx.Err() != nil {
					return
				}
				ok, err := s.TryProcessSource(ctx, sourceID, TaskMeta{Trigger: "sweep", AdapterID: "sweep"})
				if err != nil {
					select {
					case errCh <- errors.Wrapf(err, "normalize pending source %s", sourceID):
						cancel()
					default:
					}
					return
				}
				if ok {
					mu.Lock()
					processed++
					mu.Unlock()
				}
				_ = workerID
			}
		}(i + 1)
	}

sendLoop:
	for _, sourceID := range ids {
		select {
		case <-ctx.Done():
			break sendLoop
		case jobs <- sourceID:
		}
	}
	close(jobs)
	wg.Wait()

	select {
	case err := <-errCh:
		return processed, err
	default:
		return processed, nil
	}
}

// ProcessParseCompleted normalizes one source end-to-end: every active raw row is
// matched to the catalog; matched rows become gold offers (published atomically),
// misses go to the review queue.
func (s *Service) ProcessParseCompleted(ctx context.Context, body []byte) error {
	var p ndomain.ParseCompletedPayload
	if err := json.Unmarshal(body, &p); err != nil {
		return errors.Wrap(err, "unmarshal parse.completed")
	}
	if p.SourceID == "" {
		return errors.New("parse.completed missing source_id")
	}
	sourceID, err := uuid.Parse(p.SourceID)
	if err != nil {
		return errors.Wrap(err, "bad source_id in parse.completed")
	}

	_, err = s.TryProcessSource(ctx, sourceID, TaskMeta{
		MsgID:       p.MsgID,
		AdapterID:   p.AdapterID,
		RowsWritten: p.RowsWritten,
		ParsedAt:    p.ParsedAt,
		Trigger:     "event",
	})
	return err
}

func (s *Service) TryProcessSource(ctx context.Context, sourceID uuid.UUID, meta TaskMeta) (bool, error) {
	if _, loaded := s.inflight.LoadOrStore(sourceID, struct{}{}); loaded {
		s.log.Info("normalize skipped source already in progress", "trigger", meta.Trigger, "source_id", sourceID.String())
		return false, nil
	}
	defer s.inflight.Delete(sourceID)
	return true, s.ProcessSource(ctx, sourceID, meta)
}

func (s *Service) ProcessSource(ctx context.Context, sourceID uuid.UUID, meta TaskMeta) error {
	started := time.Now()
	parsedAt := ""
	if !meta.ParsedAt.IsZero() {
		parsedAt = meta.ParsedAt.Format(time.RFC3339)
	}

	source, found, err := s.repo.SourceInfo(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "resolve source info")
	}
	if !found {
		// Unknown source — registration missing/not yet committed. Skip (ack) instead
		// of dead-lettering; a retry can't help and would only spam the DLX.
		s.log.Info("normalize skipped unknown source record", "trigger", meta.Trigger)
		return nil
	}

	s.log.Info("normalize task received",
		"trigger", meta.Trigger,
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"worker_rows_written", meta.RowsWritten,
		"worker_parsed_at", parsedAt)

	rows, err := s.repo.LoadActiveRows(ctx, sourceID)
	if err != nil {
		return errors.Wrap(err, "load active rows")
	}
	s.log.Info("normalize loaded raw rows",
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"active_rows", len(rows))

	// Dedup raw rows that collapse to the same catalog service: keep the cheapest.
	offers := make(map[uuid.UUID]ndomain.Offer)
	matched, created, llmCalls, llmSkipped := 0, 0, 0, 0
	methodCounts := map[string]int{
		ndomain.MatchBound:   0,
		ndomain.MatchAlias:   0,
		ndomain.MatchCatalog: 0,
		ndomain.MatchFuzzy:   0,
		ndomain.MatchLLM:     0,
		ndomain.MatchNew:     0,
		ndomain.MatchNone:    0,
	}
	categoryCounts := map[string]int{}
	matchCache := map[string]struct {
		id     uuid.UUID
		method string
	}{}

	// Pre-pass: resolve every distinct unbound name in ONE round-trip instead of a
	// Match query per row. Misses still fall through to the (per-row) LLM curator.
	seenNames := map[string]struct{}{}
	var batchNames []string
	for _, row := range rows {
		if row.CatalogID != nil && *row.CatalogID != uuid.Nil {
			continue
		}
		name := strings.TrimSpace(row.Name)
		if name == "" || len([]rune(name)) > maxCatalogNameLen {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seenNames[key]; ok {
			continue
		}
		seenNames[key] = struct{}{}
		batchNames = append(batchNames, row.Name)
	}
	if len(batchNames) > 0 {
		results, err := s.repo.MatchBatch(ctx, batchNames)
		if err != nil {
			return errors.Wrap(err, "batch match")
		}
		for _, m := range results {
			entry := struct {
				id     uuid.UUID
				method string
			}{id: uuid.Nil, method: ndomain.MatchNone}
			if m.CatalogID != nil && m.Method != nil {
				entry.id, entry.method = *m.CatalogID, *m.Method
			}
			matchCache[strings.ToLower(strings.TrimSpace(m.Name))] = entry
		}
	}

	binds := make([]ndomain.BindPair, 0, len(rows))
	for i, row := range rows {
		catalogID, method := uuid.Nil, ndomain.MatchNone
		if row.CatalogID != nil && *row.CatalogID != uuid.Nil {
			catalogID = *row.CatalogID
			method = ndomain.MatchBound
		} else {
			key := strings.ToLower(strings.TrimSpace(row.Name))
			if cached, ok := matchCache[key]; ok {
				catalogID, method = cached.id, cached.method
			} else {
				var err error
				catalogID, method, err = s.repo.Match(ctx, row.Name)
				if err != nil {
					return errors.Wrapf(err, "match %q", row.Name)
				}
				if catalogID != uuid.Nil {
					matchCache[key] = struct {
						id     uuid.UUID
						method string
					}{id: catalogID, method: method}
				}
			}
		}

		// Deterministic miss → the LLM curates the catalog: anchored on the closest
		// existing entries, it decides whether this is the same service (bind) or a
		// new one (create with a clean canonical name). The LLM only sees a few
		// candidates (not the whole catalog), so it can't squash distinct services
		// the way a forced pick from a tiny catalog used to.
		if catalogID == uuid.Nil {
			name := strings.TrimSpace(row.Name)
			// Real service names are short. An empty or paragraph-length "name" is a
			// crawler mis-extraction (description text) — don't pollute the catalog;
			// send it to the review queue instead.
			if name == "" || len([]rune(name)) > maxCatalogNameLen {
				methodCounts[ndomain.MatchNone]++
				if err := s.repo.RecordUnmatched(ctx, sourceID, truncRunes(row.Name, 480)); err != nil {
					return errors.Wrap(err, "record unmatched")
				}
				continue
			}

			catalogID, method, err = s.curate(ctx, name, row, &llmCalls, &llmSkipped)
			if err != nil {
				return errors.Wrapf(err, "curate %q", name)
			}
			if err := s.repo.AddAlias(ctx, catalogID, name, "llm"); err != nil {
				return errors.Wrap(err, "add alias")
			}
			if method == ndomain.MatchNew {
				created++
			}
			matchCache[strings.ToLower(strings.TrimSpace(row.Name))] = struct {
				id     uuid.UUID
				method string
			}{id: catalogID, method: method}
		}
		matched++
		methodCounts[method]++
		if row.Category != nil && *row.Category != "" {
			categoryCounts[*row.Category]++
		}
		if row.CatalogID == nil || *row.CatalogID != catalogID {
			binds = append(binds, ndomain.BindPair{RowID: row.ID, CatalogID: catalogID})
		}

		if cur, ok := offers[catalogID]; !ok || row.PriceKZT < cur.PriceKZT {
			offers[catalogID] = ndomain.Offer{
				CatalogID:    catalogID,
				NameRaw:      strings.TrimSpace(row.Name),
				PriceKZT:     row.PriceKZT,
				Currency:     row.Currency,
				DurationDays: row.DurationDays,
				ParsedAt:     row.ParsedAt,
			}
		}
		progressLog(s.log, source.URL, i+1, len(rows), matched, created, offers, started)
	}

	// Flush all catalog bindings in one statement (was a per-row UPDATE).
	if err := s.repo.BulkBindParsed(ctx, binds); err != nil {
		return errors.Wrap(err, "bulk bind parsed rows")
	}

	list := make([]ndomain.Offer, 0, len(offers))
	for _, o := range offers {
		list = append(list, o)
	}
	if err := s.publishOffersWithRetry(ctx, sourceID, source.City, list); err != nil {
		return errors.Wrap(err, "publish offers")
	}

	// Stamp the raw layer: these rows have now been seen by normalize.
	if err := s.repo.MarkNormalized(ctx, sourceID); err != nil {
		return errors.Wrap(err, "mark normalized")
	}

	s.log.Info("RESULT normalize completed",
		"trigger", meta.Trigger,
		"source_url", source.URL,
		"clinic", valueOr(source.ClinicName, "unassigned"),
		"city", valueOr(source.City, "unknown"),
		"raw_rows", len(rows),
		"worker_rows_written", meta.RowsWritten,
		"matched", matched,
		"created_catalog_entries", created,
		"llm_calls", llmCalls,
		"llm_skipped", llmSkipped,
		"gold_offers", len(list),
		"deduped_matches", matched-len(list),
		"methods", methodCounts,
		"raw_categories", categoryCounts,
		"duration_s", time.Since(started).Seconds())
	return nil
}

func (s *Service) publishOffersWithRetry(ctx context.Context, sourceID uuid.UUID, city *string, list []ndomain.Offer) error {
	const attempts = 3
	var err error
	for attempt := 1; attempt <= attempts; attempt++ {
		err = s.repo.PublishOffers(ctx, sourceID, city, list)
		if err == nil {
			return nil
		}
		if !s.repo.IsRetryable(err) || attempt == attempts {
			return err
		}
		delay := time.Duration(attempt*150) * time.Millisecond
		s.log.Error("normalize publish offers retrying after transient database error",
			"source_id", sourceID.String(), "attempt", attempt, "delay_ms", delay.Milliseconds(), "err", err)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return err
}

func progressLog(log rabbitmq.Logger, sourceLabel string, done, total, matched, unmatched int, offers map[uuid.UUID]ndomain.Offer, started time.Time) {
	if total < 500 {
		return
	}
	if done != total && done%500 != 0 {
		return
	}
	log.Info("normalize progress",
		"source_url", sourceLabel,
		"done", done,
		"total", total,
		"matched", matched,
		"unmatched", unmatched,
		"gold_offers_so_far", len(offers),
		"duration_s", time.Since(started).Seconds())
}

// curate resolves a deterministic miss into a catalog id. With the LLM it anchors
// on the closest existing entries and decides match-vs-create; without it (or with
// no close candidates) it falls back to a verbatim auto-create. Returns the bound
// catalog id and the match method.
func (s *Service) curate(ctx context.Context, name string, row ndomain.RawRow, llmCalls *int, llmSkipped *int) (uuid.UUID, string, error) {
	create := func() (uuid.UUID, string, error) {
		id, err := s.repo.EnsureCatalogEntry(ctx, name, categoryEnum(row), "")
		return id, ndomain.MatchNew, err
	}
	if s.llm == nil || s.llm.Disabled() {
		(*llmSkipped)++
		return create()
	}
	if s.maxLLMCallsPerSource >= 0 && *llmCalls >= s.maxLLMCallsPerSource {
		(*llmSkipped)++
		return create()
	}
	cands, err := s.repo.TopCatalogCandidates(ctx, name, llmCandidateLimit)
	if err != nil {
		return uuid.Nil, "", err
	}
	if len(cands) == 0 {
		return create() // nothing close — clearly a new service, no LLM call needed
	}
	if similarity(name, cands[0].Name) < minLLMCandidateSimilarity {
		(*llmSkipped)++
		return create()
	}

	hint := ""
	if row.Category != nil {
		hint = *row.Category
	}
	(*llmCalls)++
	dec, lerr := s.llm.Curate(ctx, name, hint, cands)
	if lerr != nil {
		if errors.Is(lerr, ndomain.ErrLLMDisabled) || s.llm.Disabled() {
			s.log.Error("normalize LLM disabled; continuing without LLM", "err", lerr)
		}
		s.log.Error("normalize curate failed; auto-creating", "raw", name, "err", lerr)
		return create()
	}
	if dec.Match && dec.Index >= 1 && dec.Index <= len(cands) {
		return cands[dec.Index-1].ID, ndomain.MatchLLM, nil
	}
	// New canonical service: name, category and description authored by the LLM.
	cn := strings.TrimSpace(dec.CanonicalName)
	if cn == "" {
		cn = name
	}
	id, err := s.repo.EnsureCatalogEntry(ctx, truncRunes(cn, maxCatalogNameLen),
		validCategory(dec.Category, row), strings.TrimSpace(dec.Description))
	return id, ndomain.MatchNew, err
}

func similarity(a, b string) float64 {
	ak := tokenSet(a)
	bk := tokenSet(b)
	if len(ak) == 0 || len(bk) == 0 {
		return 0
	}
	inter := 0
	for token := range ak {
		if _, ok := bk[token]; ok {
			inter++
		}
	}
	return float64(inter) / math.Sqrt(float64(len(ak)*len(bk)))
}

func tokenSet(s string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, part := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'а' && r <= 'я' || r == 'ё' || r >= '0' && r <= '9')
	}) {
		if len([]rune(part)) >= 2 {
			out[part] = struct{}{}
		}
	}
	return out
}

// validCategory normalizes an LLM-suggested category to a valid enum value,
// falling back to the keyword heuristic when the LLM returns something off-list.
func validCategory(c string, row ndomain.RawRow) string {
	if c == "приём врача" {
		c = "прием врача"
	}
	switch c {
	case "лаборатория", "прием врача", "диагностика", "процедура":
		return c
	}
	return categoryEnum(row)
}

// categoryEnum maps a raw row to a valid service_category enum value. The crawler's
// category hint is freeform/English, so we keyword-classify name + hint, defaulting
// to 'лаборатория' (labs dominate the data).
func categoryEnum(row ndomain.RawRow) string {
	hint := ""
	if row.Category != nil {
		hint = *row.Category
	}
	s := strings.ToLower(hint + " " + row.Name)
	switch {
	case containsAny(s, "узи", "мрт", "кт ", "рентген", "ренгрен", "экг", "ээг", "эхо",
		"диагност", "эндоскоп", "гастроскоп", "колоноскоп", "флюорограф", "маммограф",
		"томограф", "densitomet", "radiology", "ultrasound", "x-ray", "mri"):
		return "диагностика"
	case containsAny(s, "прием", "приём", "консультац", "осмотр", "врач", "doctor",
		"specialist", "consult"):
		return "прием врача"
	case containsAny(s, "процедур", "инъекц", "укол", "массаж", "капельниц", "перевязк",
		"манипул", "удален", "биопси", "пункци", "вакцин", "прививк", "procedure"):
		return "процедура"
	default:
		return "лаборатория"
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func valueOr(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
