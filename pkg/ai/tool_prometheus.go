package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
	"github.com/zxh326/kite/pkg/cluster"
)

func executeQueryPrometheus(ctx context.Context, cs *cluster.ClientSet, args map[string]interface{}) (string, bool) {
	query, err := getRequiredString(args, "query")
	if err != nil {
		return "Error: " + err.Error(), true
	}

	// Check if Prometheus client is available
	if cs.PromClient == nil {
		return "Error: Prometheus is not configured for this cluster. Please configure Prometheus URL in cluster settings.", true
	}

	queryType, _ := args["query_type"].(string)
	if queryType == "" {
		queryType = "instant"
	}

	duration, _ := args["duration"].(string)
	if duration == "" {
		duration = "1h"
	}

	var result string
	var queryErr error

	switch queryType {
	case "instant":
		result, queryErr = executeInstantQuery(ctx, cs, query)
	case "range":
		result, queryErr = executeRangeQuery(ctx, cs, query, duration)
	default:
		return fmt.Sprintf("Error: unsupported query_type '%s'. Use 'instant' or 'range'.", queryType), true
	}

	if queryErr != nil {
		return fmt.Sprintf("Error executing Prometheus query: %v", queryErr), true
	}

	return result, false
}

func executeInstantQuery(ctx context.Context, cs *cluster.ClientSet, query string) (string, error) {
	result, warnings, err := cs.PromClient.Query(ctx, query, time.Now())
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Prometheus Query: %s\n\n", query))

	if len(warnings) > 0 {
		sb.WriteString(fmt.Sprintf("Warnings: %v\n\n", warnings))
	}

	switch result.Type() {
	case model.ValVector:
		vector := result.(model.Vector)
		if len(vector) == 0 {
			sb.WriteString("No data returned.\n")
		} else {
			sb.WriteString(fmt.Sprintf("Results (%d series):\n", len(vector)))
			for _, sample := range vector {
				sb.WriteString(fmt.Sprintf("- %s: %v\n", sample.Metric, sample.Value))
			}
		}
	case model.ValScalar:
		scalar := result.(*model.Scalar)
		sb.WriteString(fmt.Sprintf("Scalar value: %v at %v\n", scalar.Value, scalar.Timestamp.Time()))
	case model.ValString:
		str := result.(*model.String)
		sb.WriteString(fmt.Sprintf("String value: %s at %v\n", str.Value, str.Timestamp.Time()))
	default:
		sb.WriteString(fmt.Sprintf("Unexpected result type: %s\n", result.Type()))
	}

	return sb.String(), nil
}

func executeRangeQuery(ctx context.Context, cs *cluster.ClientSet, query string, duration string) (string, error) {
	var timeRange time.Duration
	var step time.Duration

	switch duration {
	case "30m":
		timeRange = 30 * time.Minute
		step = 1 * time.Minute
	case "1h":
		timeRange = 1 * time.Hour
		step = 2 * time.Minute
	case "24h":
		timeRange = 24 * time.Hour
		step = 30 * time.Minute
	default:
		return "", fmt.Errorf("unsupported duration: %s. Use '30m', '1h', or '24h'", duration)
	}

	now := time.Now()
	start := now.Add(-timeRange)

	r := v1.Range{
		Start: start,
		End:   now,
		Step:  step,
	}

	result, warnings, err := cs.PromClient.QueryRange(ctx, query, r)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Prometheus Range Query: %s\n", query))
	sb.WriteString(fmt.Sprintf("Time Range: %s to %s (duration: %s, step: %v)\n\n", start.Format("15:04:05"), now.Format("15:04:05"), duration, step))

	if len(warnings) > 0 {
		sb.WriteString(fmt.Sprintf("Warnings: %v\n\n", warnings))
	}

	switch result.Type() {
	case model.ValMatrix:
		matrix := result.(model.Matrix)
		if len(matrix) == 0 {
			sb.WriteString("No data returned.\n")
		} else {
			sb.WriteString(fmt.Sprintf("Results (%d series):\n\n", len(matrix)))
			for seriesIdx, series := range matrix {
				sb.WriteString(fmt.Sprintf("Series %d: %s\n", seriesIdx+1, series.Metric))

				// Show summary statistics
				if len(series.Values) > 0 {
					var sum, min, max float64
					min = float64(series.Values[0].Value)
					max = float64(series.Values[0].Value)

					for _, sample := range series.Values {
						val := float64(sample.Value)
						sum += val
						if val < min {
							min = val
						}
						if val > max {
							max = val
						}
					}
					avg := sum / float64(len(series.Values))

					sb.WriteString(fmt.Sprintf("  Data points: %d\n", len(series.Values)))
					sb.WriteString(fmt.Sprintf("  Min: %.2f, Max: %.2f, Avg: %.2f\n", min, max, avg))

					// Show first and last few values
					showCount := 3
					if len(series.Values) <= showCount*2 {
						showCount = len(series.Values) / 2
					}

					if showCount > 0 {
						sb.WriteString("  First values:\n")
						for i := 0; i < showCount && i < len(series.Values); i++ {
							sample := series.Values[i]
							sb.WriteString(fmt.Sprintf("    %s: %.2f\n", sample.Timestamp.Time().Format("15:04:05"), sample.Value))
						}

						if len(series.Values) > showCount*2 {
							sb.WriteString("  ...\n")
							sb.WriteString("  Last values:\n")
							for i := len(series.Values) - showCount; i < len(series.Values); i++ {
								sample := series.Values[i]
								sb.WriteString(fmt.Sprintf("    %s: %.2f\n", sample.Timestamp.Time().Format("15:04:05"), sample.Value))
							}
						}
					}
				}
				sb.WriteString("\n")
			}
		}
	default:
		sb.WriteString(fmt.Sprintf("Unexpected result type: %s\n", result.Type()))
	}

	return sb.String(), nil
}
