package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"
)

type Answers struct {
	Direction string `json:"direction"`
	API       string `json:"api"`
	Quality   string `json:"quality"`
	Volume    string `json:"volume"`
	Mapping   string `json:"mapping"`
}

type Requirement struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Evidence string `json:"evidence"`
}

type Scope struct {
	Summary        string        `json:"summary"`
	Requirements   []Requirement `json:"requirements"`
	InitialAnswers Answers       `json:"initialAnswers"`
	Risks          []string      `json:"risks"`
	Parser         string        `json:"parser"`
}

type EstimateRequest struct {
	Scope         Scope    `json:"scope"`
	Answers       Answers  `json:"answers"`
	Excluded      []string `json:"excluded"`
	HistoryPolicy string   `json:"historyPolicy"`
}

type GeneralWorkPackage struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Complexity string `json:"complexity"`
}

type GeneralEstimateRequest struct {
	WorkPackages []GeneralWorkPackage `json:"workPackages"`
}

type History struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Synthetic bool               `json:"synthetic"`
	Features  Answers            `json:"features"`
	Base      map[string]float64 `json:"base"`
	Actual    map[string]float64 `json:"actual"`
}

type Task struct {
	Category     string   `json:"category"`
	Label        string   `json:"label"`
	Base         float64  `json:"base"`
	Factor       float64  `json:"factor"`
	Hours        float64  `json:"hours"`
	Low          int      `json:"low"`
	High         int      `json:"high"`
	Observations int      `json:"observations"`
	ReferenceIDs []string `json:"referenceIds"`
}

type Reference struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Synthetic   bool     `json:"synthetic"`
	Score       float64  `json:"score"`
	Hours       float64  `json:"hours"`
	KnownKeys   []string `json:"knownKeys"`
	MatchedKeys []string `json:"matchedKeys"`
}

type Estimate struct {
	Tasks       []Task         `json:"tasks"`
	Low         int            `json:"low"`
	High        int            `json:"high"`
	Hours       float64        `json:"hours"`
	BaseHours   float64        `json:"baseHours"`
	Blockers    []string       `json:"blockers"`
	Assumptions []string       `json:"assumptions"`
	References  []Reference    `json:"references"`
	Provenance  map[string]any `json:"provenance"`
}

var categories = []string{"discovery", "authentication", "mapping", "import", "sync", "deduplication", "testing", "handover"}
var taskNames = map[string]string{
	"discovery": "Discovery & acceptance criteria", "authentication": "API connection & authentication",
	"mapping": "Field mapping & transformation", "import": "Historical data import", "sync": "Scheduled synchronization",
	"deduplication": "Duplicates & reconciliation", "testing": "Testing & failure recovery", "handover": "Deployment & handover",
}
var driverWeights = map[string]float64{"direction": 3, "api": 3, "quality": 2, "volume": 1, "mapping": 2}
var baseHours = map[string]float64{"discovery": 5, "authentication": 8, "mapping": 10, "import": 12, "sync": 16, "deduplication": 8, "testing": 12, "handover": 6}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
		switch attr.Key {
		case slog.TimeKey:
			return slog.String("timestamp", attr.Value.Time().UTC().Format(time.RFC3339Nano))
		case slog.LevelKey:
			return slog.String("severity", strings.ToLower(attr.Value.String()))
		case slog.MessageKey:
			return slog.String("event", attr.Value.String())
		default:
			return attr
		}
	}})))

	host := envOrDefault("HOST", "127.0.0.1")
	port := os.Getenv("PORT")
	if port == "" {
		port = "8002"
	}
	requestTimeout, err := configuredTimeout("REQUEST_TIMEOUT", 8*time.Second, 30*time.Second)
	if err != nil {
		slog.Error("invalid_server_configuration", "service", "estimator-go", "setting", "REQUEST_TIMEOUT")
		os.Exit(2)
	}
	readHeaderTimeout := 5 * time.Second
	if requestTimeout < readHeaderTimeout {
		readHeaderTimeout = requestTimeout
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "engine": "integration-effort/2.0"})
	})
	mux.HandleFunc("POST /v1/estimates", estimateHandler)
	mux.HandleFunc("POST /v1/estimates/general", generalEstimateHandler)
	server := &http.Server{
		Addr:              net.JoinHostPort(host, port),
		Handler:           requestLogging(jsonTimeoutHandler(requestTimeout, mux)),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       requestTimeout,
		WriteTimeout:      requestTimeout + time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	shutdownContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			slog.Error("server_shutdown_failed", "service", "estimator-go", "error", err.Error())
		} else {
			slog.Info("server_shutdown", "service", "estimator-go")
		}
	}()

	slog.Info("server_start", "service", "estimator-go", "address", server.Addr, "request_timeout_ms", requestTimeout.Milliseconds())
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server_failed", "service", "estimator-go", "error", err.Error())
		os.Exit(1)
	}
}

func jsonTimeoutHandler(timeout time.Duration, next http.Handler) http.Handler {
	timed := http.TimeoutHandler(next, timeout, `{"error":"Service request timed out."}`)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		timed.ServeHTTP(&timeoutResponseWriter{ResponseWriter: w}, r)
	})
}

type timeoutResponseWriter struct {
	http.ResponseWriter
}

func (w *timeoutResponseWriter) WriteHeader(status int) {
	if status == http.StatusServiceUnavailable {
		w.Header().Set("content-type", "application/json")
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *timeoutResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func configuredTimeout(name string, fallback, maximum time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed < time.Second || parsed > maximum {
		return 0, fmt.Errorf("%s must be between 1s and %s", name, maximum)
	}
	return parsed, nil
}

func requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if !validRequestID(id) {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		startedAt := time.Now()
		panicRecovered := false
		defer func() {
			if recover() != nil {
				panicRecovered = true
				if !recorder.wroteHeader {
					writeJSON(recorder, http.StatusInternalServerError, map[string]string{"error": "Internal server error."})
				}
			}
			level := slog.LevelInfo
			if recorder.status >= http.StatusInternalServerError {
				level = slog.LevelError
			}
			slog.Log(r.Context(), level, "http_request",
				"service", "estimator-go",
				"request_id", id,
				"method", r.Method,
				"path", r.URL.Path,
				"status", recorder.status,
				"duration_ms", float64(time.Since(startedAt).Microseconds())/1000,
				"panic_recovered", panicRecovered,
			)
		}()
		next.ServeHTTP(recorder, r)
	})
}

func validRequestID(value string) bool {
	normalized := value
	if len(value) == 36 {
		for _, index := range []int{8, 13, 18, 23} {
			if value[index] != '-' {
				return false
			}
		}
		normalized = strings.ReplaceAll(value, "-", "")
	} else if len(value) != 32 {
		return false
	}
	_, err := hex.DecodeString(normalized)
	return err == nil
}

func newRequestID() string {
	var random [16]byte
	if _, err := rand.Read(random[:]); err == nil {
		return hex.EncodeToString(random[:])
	}
	return fmt.Sprintf("%032x", time.Now().UTC().UnixNano())
}

type responseRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *responseRecorder) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseRecorder) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *responseRecorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func estimateHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()
	var req EstimateRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid estimate request: " + err.Error()})
		return
	}
	result, err := estimate(req)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func generalEstimateHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()
	var req GeneralEstimateRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid general estimate request: " + err.Error()})
		return
	}
	result, err := estimateGeneral(req)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func estimateGeneral(req GeneralEstimateRequest) (Estimate, error) {
	if len(req.WorkPackages) == 0 || len(req.WorkPackages) > 30 {
		return Estimate{}, errors.New("workPackages must contain between 1 and 30 items")
	}
	tasks := make([]Task, 0, len(req.WorkPackages))
	seen := make(map[string]bool, len(req.WorkPackages))
	var totalHours float64
	var totalLow, totalHigh int
	for _, item := range req.WorkPackages {
		id := strings.TrimSpace(item.ID)
		title := strings.TrimSpace(item.Title)
		if id == "" || len(id) > 80 || title == "" || len(title) > 240 {
			return Estimate{}, errors.New("each work package needs an ID and a title within the documented limits")
		}
		if seen[id] {
			return Estimate{}, fmt.Errorf("duplicate work package ID: %s", id)
		}
		seen[id] = true
		var base float64
		var low, high int
		switch item.Complexity {
		case "small":
			base, low, high = 4, 2, 8
		case "moderate":
			base, low, high = 16, 8, 32
		case "complex":
			base, low, high = 48, 24, 96
		default:
			return Estimate{}, fmt.Errorf("work package %q complexity must be small, moderate, or complex", id)
		}
		tasks = append(tasks, Task{
			Category: id, Label: title, Base: base, Factor: 1, Hours: base,
			Low: low, High: high, Observations: 0, ReferenceIDs: []string{},
		})
		totalHours += base
		totalLow += low
		totalHigh += high
	}
	return Estimate{
		Tasks: tasks, Low: totalLow, High: totalHigh, Hours: round1(totalHours), BaseHours: round1(totalHours),
		Blockers: []string{},
		Assumptions: []string{
			"General-work complexity bands are rough, uncalibrated planning priors, not predictions learned from recorded deliveries.",
			"A human must review agent-assigned complexity and the completeness of each work package before using this range.",
			"Ranges are person-hours and do not represent elapsed time, staffing capacity, or a statistical confidence interval.",
		},
		References: []Reference{},
		Provenance: map[string]any{
			"engineVersion": "general-planning/1.0", "mode": "general", "dataBasis": "uncalibrated planning priors",
			"referenceIds": []string{}, "complexityBands": map[string][]float64{
				"small": {2, 4, 8}, "moderate": {8, 16, 32}, "complex": {24, 48, 96},
			},
		},
	}, nil
}

func estimate(req EstimateRequest) (Estimate, error) {
	if req.HistoryPolicy == "" {
		req.HistoryPolicy = "demo"
	}
	if req.HistoryPolicy != "demo" && req.HistoryPolicy != "recorded" {
		return Estimate{}, errors.New("historyPolicy must be demo or recorded")
	}
	if err := validateAnswers(req.Answers); err != nil {
		return Estimate{}, err
	}
	for _, reqItem := range req.Scope.Requirements {
		if _, ok := taskNames[reqItem.ID]; !ok {
			return Estimate{}, fmt.Errorf("unknown requirement category: %s", reqItem.ID)
		}
	}
	excluded := map[string]bool{}
	for _, category := range req.Excluded {
		if _, ok := taskNames[category]; !ok {
			return Estimate{}, fmt.Errorf("unknown excluded category: %s", category)
		}
		excluded[category] = true
	}
	included := map[string]bool{"discovery": true, "mapping": true, "testing": true, "handover": true}
	for _, item := range req.Scope.Requirements {
		included[item.ID] = true
	}
	syncIncluded := included["sync"] && !excluded["sync"]
	if syncIncluded {
		included["authentication"] = true
	}
	for category := range excluded {
		delete(included, category)
	}

	bases := map[string]float64{}
	for category, hours := range baseHours {
		bases[category] = hours
	}
	if req.Answers.API == "custom" {
		bases["authentication"] = 20
	} else {
		bases["authentication"] = 8
	}
	if req.Answers.Mapping == "custom" {
		bases["mapping"] = 18
	} else {
		bases["mapping"] = 10
	}
	if req.Answers.Direction == "two-way" {
		bases["sync"] = 30
	} else {
		bases["sync"] = 16
	}
	if req.Answers.Quality == "mixed" {
		bases["deduplication"] = 12
	} else {
		bases["deduplication"] = 8
	}
	if syncIncluded && req.Answers.Direction == "two-way" {
		bases["testing"] = 18
	} else {
		bases["testing"] = 12
	}
	if req.Answers.Quality == "mixed" {
		bases["import"] *= 1.4
	}
	if req.Answers.Volume == "large" {
		bases["import"] *= 1.6
		bases["testing"] *= 1.25
	}
	if req.Answers.Volume == "small" {
		bases["import"] *= .75
	}
	unknown := 0
	for _, v := range []string{req.Answers.Direction, req.Answers.API, req.Answers.Quality, req.Answers.Volume, req.Answers.Mapping} {
		if v == "unknown" {
			unknown++
		}
	}

	history := seedHistory()
	if req.HistoryPolicy == "recorded" {
		history = []History{}
	}
	ranked := make([]scoredHistory, 0, len(history))
	for _, h := range history {
		ranked = append(ranked, scoredHistory{History: h, Score: similarity(req.Answers, h.Features)})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].Score == ranked[j].Score {
			return ranked[i].ID < ranked[j].ID
		}
		return ranked[i].Score > ranked[j].Score
	})

	tasks := make([]Task, 0, len(included))
	var totalHours, totalBase float64
	var totalLow, totalHigh int
	for _, category := range categories {
		if !included[category] {
			continue
		}
		comparables := make([]scoredHistory, 0)
		ratios := make([]float64, 0)
		for _, candidate := range ranked {
			base, actual := candidate.Base[category], candidate.Actual[category]
			if candidate.Score >= .45 && base > 0 && actual > 0 && !math.IsNaN(actual) && !math.IsInf(actual, 0) {
				comparables = append(comparables, candidate)
				ratio := actual / base
				ratios = append(ratios, math.Max(.35, math.Min(3, ratio)))
			}
		}
		support := float64(len(ratios)) / (float64(len(ratios)) + 4)
		factor := 1.0
		if len(ratios) > 0 {
			factor = 1 + support*(median(ratios)-1)
		}
		hours := round1(bases[category] * factor)
		spread := .4
		if len(ratios) > 1 {
			spread = max(ratios) - min(ratios)
		}
		low := int(math.Floor(hours * math.Max(.65, .85-float64(unknown)*.025)))
		high := int(math.Ceil(hours * (1.18 + float64(unknown)*.075 + math.Min(.35, spread/3) + map[bool]float64{true: .12, false: 0}[len(ratios) < 3])))
		refIDs := make([]string, 0, len(comparables))
		for _, h := range comparables {
			refIDs = append(refIDs, h.ID)
		}
		tasks = append(tasks, Task{Category: category, Label: taskNames[category], Base: round1(bases[category]), Factor: math.Round(factor*100) / 100, Hours: hours, Low: low, High: high, Observations: len(ratios), ReferenceIDs: refIDs})
		totalHours += hours
		totalBase += bases[category]
		totalLow += low
		totalHigh += high
	}

	blockers := []string{}
	requestedIncluded := 0
	for _, item := range req.Scope.Requirements {
		if !excluded[item.ID] {
			requestedIncluded++
		}
	}
	if requestedIncluded == 0 {
		blockers = append(blockers, "Include at least one requested deliverable in the scope.")
	}
	if syncIncluded && req.Answers.Direction == "unknown" {
		blockers = append(blockers, "Confirm the direction of synchronization.")
	}
	if syncIncluded && req.Answers.API == "unknown" {
		blockers = append(blockers, "Confirm API documentation and access, or include custom API work.")
	}
	assumptions := []string{"Effort is in person-hours. Elapsed delivery time depends on team availability.", "Discovery, testing and handover are delivery work included in the estimate."}
	if req.Answers.Mapping == "unknown" {
		assumptions = append(assumptions, "Field mapping is provisionally standard; custom business rules are unconfirmed.")
	}
	if req.Answers.Quality == "unknown" {
		assumptions = append(assumptions, "Source data quality has not been assessed.")
	}
	if req.Answers.Volume == "unknown" {
		assumptions = append(assumptions, "Record volume is unconfirmed.")
	}
	if req.HistoryPolicy == "recorded" {
		assumptions = append(assumptions, "No comparable recorded delivery is available; base task assumptions are used.")
	}

	references := make([]Reference, 0, 3)
	for _, item := range ranked {
		if item.Score < .45 || len(references) == 3 {
			continue
		}
		var refHours float64
		for _, n := range item.Actual {
			refHours += n
		}
		known, matched := []string{}, []string{}
		for _, key := range []string{"direction", "api", "quality", "volume", "mapping"} {
			if answerValue(req.Answers, key) != "unknown" {
				known = append(known, key)
				if answerValue(req.Answers, key) == answerValue(item.Features, key) {
					matched = append(matched, key)
				}
			}
		}
		references = append(references, Reference{ID: item.ID, Name: item.Name, Synthetic: item.Synthetic, Score: item.Score, Hours: round1(refHours), KnownKeys: known, MatchedKeys: matched})
	}
	usedIDs := map[string]bool{}
	for _, task := range tasks {
		for _, id := range task.ReferenceIDs {
			usedIDs[id] = true
		}
	}
	referenceIDs := make([]string, 0, len(usedIDs))
	for id := range usedIDs {
		referenceIDs = append(referenceIDs, id)
	}
	sort.Strings(referenceIDs)
	return Estimate{Tasks: tasks, Low: totalLow, High: totalHigh, Hours: round1(totalHours), BaseHours: round1(totalBase), Blockers: blockers, Assumptions: assumptions, References: references, Provenance: map[string]any{"engineVersion": "integration-effort/2.0", "historyPolicy": req.HistoryPolicy, "similarityThreshold": .45, "priorObservations": 4, "ratioBounds": []float64{.35, 3}, "driverWeights": driverWeights, "referenceIds": referenceIDs}}, nil
}

type scoredHistory struct {
	History
	Score float64
}

func validateAnswers(a Answers) error {
	if !oneOf(a.Direction, "unknown", "one-way", "two-way") {
		return errors.New("answers.direction is invalid")
	}
	if !oneOf(a.API, "unknown", "documented", "custom") {
		return errors.New("answers.api is invalid")
	}
	if !oneOf(a.Quality, "unknown", "clean", "mixed") {
		return errors.New("answers.quality is invalid")
	}
	if !oneOf(a.Volume, "unknown", "small", "medium", "large") {
		return errors.New("answers.volume is invalid")
	}
	if !oneOf(a.Mapping, "unknown", "standard", "custom") {
		return errors.New("answers.mapping is invalid")
	}
	return nil
}
func oneOf(s string, choices ...string) bool {
	for _, c := range choices {
		if s == c {
			return true
		}
	}
	return false
}
func answerValue(a Answers, key string) string {
	switch key {
	case "direction":
		return a.Direction
	case "api":
		return a.API
	case "quality":
		return a.Quality
	case "volume":
		return a.Volume
	case "mapping":
		return a.Mapping
	}
	return ""
}
func similarity(a, b Answers) float64 {
	var matched, known float64
	for key, weight := range driverWeights {
		if answerValue(a, key) != "unknown" {
			known += weight
			if answerValue(a, key) == answerValue(b, key) {
				matched += weight
			}
		}
	}
	if known == 0 {
		return 0
	}
	return matched / known
}
func median(values []float64) float64 {
	a := append([]float64{}, values...)
	sort.Float64s(a)
	m := len(a) / 2
	if len(a)%2 == 1 {
		return a[m]
	}
	return (a[m-1] + a[m]) / 2
}
func round1(n float64) float64 { return math.Round(n*10) / 10 }
func min(a []float64) float64 {
	n := a[0]
	for _, v := range a[1:] {
		if v < n {
			n = v
		}
	}
	return n
}
func max(a []float64) float64 {
	n := a[0]
	for _, v := range a[1:] {
		if v > n {
			n = v
		}
	}
	return n
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func seedHistory() []History {
	seedRows := []struct {
		name, direction, api, quality, volume, mapping string
		scale                                          float64
	}{
		{"Northstar · contact sync", "one-way", "documented", "clean", "medium", "standard", 1.04},
		{"Lumen · customer migration", "one-way", "documented", "mixed", "medium", "standard", 1.18},
		{"Atlas · CRM integration", "two-way", "documented", "mixed", "medium", "custom", 1.29},
		{"Acorn · contact import", "one-way", "documented", "clean", "small", "standard", .93},
		{"Cedar · legacy migration", "one-way", "custom", "mixed", "large", "custom", 1.31},
		{"Orbit · nightly sync", "one-way", "documented", "mixed", "medium", "standard", 1.13},
		{"Fable · CRM migration", "one-way", "documented", "mixed", "small", "standard", 1.09},
		{"Meridian · two-way sync", "two-way", "custom", "clean", "large", "custom", 1.22},
	}
	rows := make([]History, 0, len(seedRows))
	for i, row := range seedRows {
		features := Answers{Direction: row.direction, API: row.api, Quality: row.quality, Volume: row.volume, Mapping: row.mapping}
		actual := map[string]float64{}
		for category, base := range baseHours {
			multiplier := 1.0
			if category == "import" && row.quality == "mixed" {
				multiplier = 1.35
			} else if category == "testing" {
				multiplier = 1.15
			}
			actual[category] = round1(base * row.scale * multiplier)
		}
		base := map[string]float64{}
		for category, hours := range baseHours {
			base[category] = hours
		}
		rows = append(rows, History{ID: fmt.Sprintf("sample-%d", i+1), Name: row.name, Synthetic: true, Features: features, Base: base, Actual: actual})
	}
	return rows
}
