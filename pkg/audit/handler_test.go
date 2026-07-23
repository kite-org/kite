package audit

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestListAuditLogsFiltersOrdersAndPaginates(t *testing.T) {
	db := setupAuditTestDB(t)
	alice := model.User{Username: "alice", Provider: model.AuthProviderPassword}
	bob := model.User{Username: "bob", Provider: model.AuthProviderPassword}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatalf("creating alice: %v", err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatalf("creating bob: %v", err)
	}

	baseTime := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	history := []model.ResourceHistory{
		{
			CreatedAt:   baseTime,
			ClusterName: "prod", ResourceType: "pods", ResourceName: "web-old", Namespace: "default",
			OperationType: "update", OperationSource: "manual", OperatorID: alice.ID, Success: true,
		},
		{
			CreatedAt:   baseTime.Add(time.Hour),
			ClusterName: "prod", ResourceType: "pods", ResourceName: "web-new", Namespace: "default",
			OperationType: "update", OperationSource: "manual", OperatorID: alice.ID, Success: true,
		},
		{
			CreatedAt:   baseTime.Add(2 * time.Hour),
			ClusterName: "staging", ResourceType: "deployments", ResourceName: "web-other", Namespace: "team-a",
			OperationType: "delete", OperationSource: "manual", OperatorID: bob.ID, Success: true,
		},
	}
	if err := db.Create(&history).Error; err != nil {
		t.Fatalf("creating audit history: %v", err)
	}

	url := fmt.Sprintf("/audit?page=1&size=1&operatorId=%d&cluster=prod&resourceType=pods&namespace=default&operation=update&search=web", alice.ID)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, url, nil)

	ListAuditLogs(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response struct {
		Data  []model.ResourceHistory `json:"data"`
		Total int64                   `json:"total"`
		Page  int                     `json:"page"`
		Size  int                     `json:"size"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if response.Total != 2 || response.Page != 1 || response.Size != 1 || len(response.Data) != 1 {
		t.Fatalf("pagination response = %#v", response)
	}
	if response.Data[0].ResourceName != "web-new" {
		t.Fatalf("first resource = %q, want newest matching record", response.Data[0].ResourceName)
	}
	if response.Data[0].Operator == nil || response.Data[0].Operator.Username != "alice" {
		t.Fatalf("preloaded operator = %#v", response.Data[0].Operator)
	}
}

func TestListAuditLogsRejectsInvalidQueryParameters(t *testing.T) {
	setupAuditTestDB(t)
	gin.SetMode(gin.TestMode)
	tests := []struct {
		query     string
		wantError string
	}{
		{"page=0", "invalid page parameter"},
		{"size=abc", "invalid size parameter"},
		{"operatorId=-1", "invalid operatorId parameter"},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/audit?"+tt.query, nil)

			ListAuditLogs(ctx)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
			}
			var body map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decoding response: %v", err)
			}
			if body["error"] != tt.wantError {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantError)
			}
		})
	}
}

func setupAuditTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("opening test database: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ResourceHistory{}); err != nil {
		t.Fatalf("migrating test database: %v", err)
	}
	model.DB = db
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB = originalDB
	})
	return db
}
