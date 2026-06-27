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
	URL          string `json:"url"`
	ClinicName   string `json:"clinic_name"`
	City         string `json:"city"`
	Address      string `json:"address"`
	Phone        string `json:"phone"`
	WorkingHours string `json:"working_hours"`
	FetchNow     bool   `json:"fetch_now"`
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
		URL:          req.URL,
		ClinicName:   req.ClinicName,
		City:         req.City,
		Address:      req.Address,
		Phone:        req.Phone,
		WorkingHours: req.WorkingHours,
		FetchNow:     req.FetchNow,
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
