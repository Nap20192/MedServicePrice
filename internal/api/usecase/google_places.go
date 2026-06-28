package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"medprice/internal/api/domain"
)

const (
	defaultGooglePlacesBaseURL = "https://places.googleapis.com"
	googlePlacesSearchMask     = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.location,places.rating,places.userRatingCount"
	googlePlacesDetailsMask    = "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,regularOpeningHours,location,rating,userRatingCount,addressComponents"
)

type GooglePlacesClient struct {
	key     string
	baseURL string
	http    *http.Client
}

func NewGooglePlacesClient(key, baseURL string) *GooglePlacesClient {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = defaultGooglePlacesBaseURL
	}
	return &GooglePlacesClient{
		key:     key,
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 12 * time.Second},
	}
}

func (c *GooglePlacesClient) SearchClinics(ctx context.Context, input domain.SearchGooglePlacesInput) ([]domain.GooglePlaceClinicCandidate, error) {
	q := strings.TrimSpace(input.Query)
	if q == "" {
		return nil, fmt.Errorf("query is required")
	}
	body := map[string]any{
		"textQuery":    q,
		"languageCode": "ru",
		"regionCode":   "KZ",
	}
	if bias := locationBias(input.Location); bias != nil {
		body["locationBias"] = bias
	}
	payload, err := c.post(ctx, "/v1/places:searchText", googlePlacesSearchMask, body)
	if err != nil {
		return nil, err
	}
	rawPlaces, _ := payload["places"].([]any)
	out := make([]domain.GooglePlaceClinicCandidate, 0, len(rawPlaces))
	for _, raw := range rawPlaces {
		if place, ok := raw.(map[string]any); ok {
			candidate := candidateFromGooglePlace(place)
			if candidate.ID != "" && candidate.Name != "" {
				out = append(out, candidate)
			}
		}
	}
	return out, nil
}

func (c *GooglePlacesClient) ClinicByID(ctx context.Context, id string) (*domain.GooglePlaceClinicCandidate, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("google place id is required")
	}
	payload, err := c.get(ctx, "/v1/places/"+id, googlePlacesDetailsMask)
	if err != nil {
		return nil, err
	}
	candidate := candidateFromGooglePlace(payload)
	if candidate.ID == "" {
		return nil, fmt.Errorf("google place %s not found", id)
	}
	return &candidate, nil
}

func (c *GooglePlacesClient) post(ctx context.Context, path, fieldMask string, body map[string]any) (map[string]any, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.key)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	return c.do(req)
}

func (c *GooglePlacesClient) get(ctx context.Context, path, fieldMask string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", c.key)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	return c.do(req)
}

func (c *GooglePlacesClient) do(req *http.Request) (map[string]any, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google places request failed: %w", err)
	}
	defer resp.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode google places response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("google places http %d: %s", resp.StatusCode, googleError(payload))
	}
	return payload, nil
}

func candidateFromGooglePlace(place map[string]any) domain.GooglePlaceClinicCandidate {
	raw, _ := json.Marshal(place)
	lat, lng := googleLocation(place["location"])
	return domain.GooglePlaceClinicCandidate{
		ID:           stringValue(place["id"]),
		Name:         displayName(place["displayName"]),
		City:         googleCity(place),
		Address:      stringValue(place["formattedAddress"]),
		Phone:        firstNonEmpty(stringValue(place["nationalPhoneNumber"]), stringValue(place["internationalPhoneNumber"])),
		WorkingHours: googleOpeningHours(place["regularOpeningHours"]),
		URL:          stringValue(place["websiteUri"]),
		Lat:          lat,
		Lng:          lng,
		Rating:       optionalFloat(place["rating"]),
		ReviewsCount: optionalInt(place["userRatingCount"]),
		Raw:          raw,
	}
}

func locationBias(value string) map[string]any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	if len(parts) != 2 {
		return nil
	}
	lon, errLon := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	lat, errLat := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if errLon != nil || errLat != nil {
		return nil
	}
	return map[string]any{
		"circle": map[string]any{
			"center": map[string]float64{
				"latitude":  lat,
				"longitude": lon,
			},
			"radius": 50000,
		},
	}
}

func displayName(raw any) string {
	m, _ := raw.(map[string]any)
	return stringValue(m["text"])
}

func googleLocation(raw any) (*float64, *float64) {
	m, _ := raw.(map[string]any)
	lat, okLat := floatValue(m["latitude"])
	lng, okLng := floatValue(m["longitude"])
	if !okLat || !okLng {
		return nil, nil
	}
	return &lat, &lng
}

func googleCity(place map[string]any) string {
	raw, _ := place["addressComponents"].([]any)
	for _, v := range raw {
		component, _ := v.(map[string]any)
		types, _ := component["types"].([]any)
		for _, t := range types {
			if stringValue(t) == "locality" || stringValue(t) == "administrative_area_level_2" {
				if name := stringValue(component["longText"]); name != "" {
					return name
				}
			}
		}
	}
	return ""
}

func googleOpeningHours(raw any) string {
	m, _ := raw.(map[string]any)
	weekday, _ := m["weekdayDescriptions"].([]any)
	lines := make([]string, 0, len(weekday))
	for _, v := range weekday {
		if s := stringValue(v); s != "" {
			lines = append(lines, s)
		}
	}
	return strings.Join(lines, "; ")
}

func googleError(payload map[string]any) string {
	errObj, _ := payload["error"].(map[string]any)
	if msg := stringValue(errObj["message"]); msg != "" {
		return msg
	}
	return stringValue(payload["message"])
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func optionalFloat(v any) *float64 {
	value, ok := floatValue(v)
	if !ok {
		return nil
	}
	return &value
}

func optionalInt(v any) *int {
	value := intValue(v)
	if value == 0 {
		return nil
	}
	return &value
}

func stringValue(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case fmt.Stringer:
		return strings.TrimSpace(x.String())
	default:
		return ""
	}
}

func floatValue(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}

func intValue(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	default:
		return 0
	}
}
