package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"medprice/internal/api/domain"
)

type Router struct {
	chi.Router
}

func NewRouter(sourceUC domain.SourceUseCase, priceUC domain.PriceUseCase, schedulerUC domain.SchedulerUseCase) *Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	sh := &sourceHandler{usecase: sourceUC}
	ph := &priceHandler{usecase: priceUC}
	sch := &schedulerHandler{usecase: schedulerUC}

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/sources", sh.AddSource)
		r.Get("/sources", sh.ListSources)
		r.Post("/sources/{sourceID}/fetch", sh.TriggerFetch)
		r.Post("/clinics", sh.CreateClinic)
		r.Get("/clinics", sh.ListClinics)
		r.Get("/scheduler", sch.GetSettings)
		r.Put("/scheduler", sch.UpdateSettings)
		r.Get("/prices", ph.SearchPrices)
	})

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	return &Router{r}
}
