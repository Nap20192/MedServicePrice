package http

import (
	"encoding/json"
	"net/http"

	"medprice/internal/api/domain"
)

type priceHandler struct {
	usecase domain.PriceUseCase
}

func (h *priceHandler) SearchPrices(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	city := r.URL.Query().Get("city")

	prices, err := h.usecase.Search(r.Context(), query, city)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(prices)
}
