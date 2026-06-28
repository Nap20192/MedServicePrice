package http

import (
	"encoding/json"
	"net/http"
	"strconv"

	"medprice/internal/api/domain"
)

type priceHandler struct {
	usecase domain.PriceUseCase
}

func (h *priceHandler) SearchPrices(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	minPrice, _ := strconv.ParseFloat(q.Get("min_price"), 64)
	maxPrice, _ := strconv.ParseFloat(q.Get("max_price"), 64)
	ratingMin, _ := strconv.ParseFloat(q.Get("rating_min"), 64)

	result, err := h.usecase.Search(r.Context(), domain.PriceSearch{
		Query:     q.Get("q"),
		ClinicID:  q.Get("clinic_id"),
		City:      q.Get("city"),
		Category:  q.Get("category"),
		Sort:      q.Get("sort"),
		MinPrice:  minPrice,
		MaxPrice:  maxPrice,
		RatingMin: ratingMin,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
