package http

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"medprice/internal/api/domain"
)

type sourceHandler struct {
	usecase domain.SourceUseCase
}

type addSourceRequest struct {
	URL      string `json:"url"`
	FetchNow bool   `json:"fetch_now"`
}

type createClinicRequest struct {
	Name         string      `json:"name"`
	City         string      `json:"city"`
	Address      string      `json:"address"`
	Phone        string      `json:"phone"`
	WorkingHours string      `json:"working_hours"`
	URL          string      `json:"url"`
	SourceIDs    []uuid.UUID `json:"source_ids"`
}

type attachClinicRequest struct {
	ClinicID uuid.UUID `json:"clinic_id"`
}

type importGooglePlaceClinicRequest struct {
	GooglePlaceID string      `json:"google_place_id"`
	SourceIDs     []uuid.UUID `json:"source_ids"`
}

type updateSchedulerRequest struct {
	FetchIntervalHours int `json:"fetch_interval_hours"`
}

type addSourceResponse struct {
	Source         *domain.SourceDetails `json:"source"`
	Status         string                `json:"status"`
	AdapterQueued  bool                  `json:"adapter_queued"`
	FetchQueued    bool                  `json:"fetch_queued"`
	AdapterExisted bool                  `json:"adapter_existed"`
}

func (h *sourceHandler) AddSource(w http.ResponseWriter, r *http.Request) {
	var req addSourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	result, err := h.usecase.AddSource(r.Context(), domain.CreateSourceInput{
		URL:      req.URL,
		FetchNow: req.FetchNow,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := addSourceResponse{
		Source:         result.Source,
		Status:         statusForResult(result),
		AdapterQueued:  result.AdapterQueued,
		FetchQueued:    result.FetchQueued,
		AdapterExisted: result.AdapterExisted,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *sourceHandler) ListSources(w http.ResponseWriter, r *http.Request) {
	sources, err := h.usecase.ListSources(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sources)
}

func (h *sourceHandler) CreateClinic(w http.ResponseWriter, r *http.Request) {
	var req createClinicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	clinic, err := h.usecase.CreateClinic(r.Context(), domain.CreateClinicInput{
		Name:         req.Name,
		City:         req.City,
		Address:      req.Address,
		Phone:        req.Phone,
		WorkingHours: req.WorkingHours,
		URL:          req.URL,
		SourceIDs:    req.SourceIDs,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clinic)
}

func (h *sourceHandler) ListClinics(w http.ResponseWriter, r *http.Request) {
	clinics, err := h.usecase.ListClinics(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clinics)
}

func (h *sourceHandler) AttachSourceToClinic(w http.ResponseWriter, r *http.Request) {
	sourceID, err := uuid.Parse(chi.URLParam(r, "sourceID"))
	if err != nil {
		http.Error(w, "invalid source id", http.StatusBadRequest)
		return
	}
	var req attachClinicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	details, err := h.usecase.AttachSourceToClinic(r.Context(), domain.AttachSourceClinicInput{
		SourceID: sourceID,
		ClinicID: req.ClinicID,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(details)
}

func (h *sourceHandler) SearchGooglePlacesClinics(w http.ResponseWriter, r *http.Request) {
	items, err := h.usecase.SearchGooglePlacesClinics(r.Context(), domain.SearchGooglePlacesInput{
		Query:    r.URL.Query().Get("q"),
		Location: r.URL.Query().Get("location"),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (h *sourceHandler) ImportGooglePlaceClinic(w http.ResponseWriter, r *http.Request) {
	var req importGooglePlaceClinicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	clinic, err := h.usecase.ImportGooglePlaceClinic(r.Context(), domain.ImportGooglePlaceClinicInput{
		GooglePlaceID: req.GooglePlaceID,
		SourceIDs:     req.SourceIDs,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(clinic)
}

func (h *sourceHandler) TriggerFetch(w http.ResponseWriter, r *http.Request) {
	sourceID, err := uuid.Parse(chi.URLParam(r, "sourceID"))
	if err != nil {
		http.Error(w, "invalid source id", http.StatusBadRequest)
		return
	}

	result, err := h.usecase.TriggerFetch(r.Context(), sourceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := addSourceResponse{
		Source:         result.Source,
		Status:         statusForResult(result),
		AdapterQueued:  result.AdapterQueued,
		FetchQueued:    result.FetchQueued,
		AdapterExisted: result.AdapterExisted,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *sourceHandler) RebuildAdapter(w http.ResponseWriter, r *http.Request) {
	sourceID, err := uuid.Parse(chi.URLParam(r, "sourceID"))
	if err != nil {
		http.Error(w, "invalid source id", http.StatusBadRequest)
		return
	}

	result, err := h.usecase.RebuildAdapter(r.Context(), sourceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := addSourceResponse{
		Source:        result.Source,
		Status:        statusForResult(result),
		AdapterQueued: result.AdapterQueued,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type schedulerHandler struct {
	usecase domain.SchedulerUseCase
}

func (h *schedulerHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.usecase.GetSettings(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (h *schedulerHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req updateSchedulerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	settings, err := h.usecase.UpdateFetchInterval(r.Context(), req.FetchIntervalHours)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func statusForResult(result *domain.SourceCommandResult) string {
	switch {
	case result.AdapterQueued && result.FetchQueued:
		return "adapter_create_and_fetch_queued"
	case result.AdapterQueued:
		return "adapter_create_queued"
	case result.FetchQueued:
		return "fetch_queued"
	default:
		return "exists"
	}
}
