package http

import (
	"encoding/json"
	"net/http"

	"medprice/internal/domain"
)

type sourceHandler struct {
	usecase domain.SourceUseCase
}

type addSourceRequest struct {
	URL        string `json:"url"`
	ClinicName string `json:"clinic_name"`
}

type addSourceResponse struct {
	ID       string `json:"id"`
	ClinicID string `json:"clinic_id"`
	URL      string `json:"url"`
	Status   string `json:"status"`
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

	source, err := h.usecase.AddSource(r.Context(), req.URL, req.ClinicName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := addSourceResponse{
		ID:       source.ID.String(),
		ClinicID: source.ClinicID.String(),
		URL:      source.URL,
		Status:   "created_and_queued",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
