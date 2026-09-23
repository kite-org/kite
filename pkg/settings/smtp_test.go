package settings

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/mail"
	"strings"
	"sync"
	"testing"

	"github.com/zxh326/kite/pkg/model"
)

type fakeSMTPServer struct {
	listener   net.Listener
	rejectAuth bool
	rejectRcpt bool

	mu       sync.Mutex
	mailFrom string
	rcptTo   string
	message  string
	done     chan struct{}
}

func newFakeSMTPServer(t *testing.T, rejectAuth, rejectRcpt bool) *fakeSMTPServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening for fake SMTP server: %v", err)
	}
	server := &fakeSMTPServer{
		listener:   listener,
		rejectAuth: rejectAuth,
		rejectRcpt: rejectRcpt,
		done:       make(chan struct{}),
	}
	go server.serve()
	t.Cleanup(func() {
		_ = listener.Close()
		<-server.done
	})
	return server
}

func (s *fakeSMTPServer) serve() {
	defer close(s.done)
	conn, err := s.listener.Accept()
	if err != nil {
		return
	}
	defer func() {
		_ = conn.Close()
	}()

	reader := bufio.NewReader(conn)
	writer := bufio.NewWriter(conn)
	write := func(message string) {
		_, _ = writer.WriteString(message)
		_ = writer.Flush()
	}
	write("220 fake SMTP server\r\n")
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "EHLO "):
			write("250-fake SMTP server\r\n250-AUTH PLAIN\r\n250 OK\r\n")
		case strings.HasPrefix(line, "AUTH PLAIN "):
			if s.rejectAuth {
				write("535 authentication failed\r\n")
			} else {
				write("235 authentication succeeded\r\n")
			}
		case strings.HasPrefix(line, "MAIL FROM:"):
			s.mu.Lock()
			s.mailFrom = strings.Trim(strings.TrimPrefix(line, "MAIL FROM:"), "<>")
			s.mu.Unlock()
			write("250 sender accepted\r\n")
		case strings.HasPrefix(line, "RCPT TO:"):
			if s.rejectRcpt {
				write("550 recipient rejected\r\n")
				continue
			}
			s.mu.Lock()
			s.rcptTo = strings.Trim(strings.TrimPrefix(line, "RCPT TO:"), "<>")
			s.mu.Unlock()
			write("250 recipient accepted\r\n")
		case line == "DATA":
			write("354 send message\r\n")
			var message strings.Builder
			for {
				dataLine, err := reader.ReadString('\n')
				if err != nil {
					return
				}
				if dataLine == ".\r\n" {
					break
				}
				message.WriteString(dataLine)
			}
			s.mu.Lock()
			s.message = message.String()
			s.mu.Unlock()
			write("250 message accepted\r\n")
		case line == "QUIT":
			write("221 goodbye\r\n")
			return
		default:
			write("500 unsupported command\r\n")
		}
	}
}

func (s *fakeSMTPServer) setting() *model.GeneralSetting {
	_, port, err := net.SplitHostPort(s.listener.Addr().String())
	if err != nil {
		panic(err)
	}
	var smtpPort int
	if _, err := fmt.Sscanf(port, "%d", &smtpPort); err != nil {
		panic(err)
	}
	return &model.GeneralSetting{
		SMTPEnabled:        true,
		SMTPHost:           "127.0.0.1",
		SMTPPort:           smtpPort,
		SMTPFromEmail:      "sender@example.com",
		SMTPFromName:       "Kite Sender",
		SMTPEncryption:     "none",
		SMTPTimeoutSeconds: 1,
	}
}

func TestSendSMTPTestEmailPlainNoneDelivers(t *testing.T) {
	server := newFakeSMTPServer(t, false, false)
	setting := server.setting()

	if err := sendSMTPTestEmail(context.Background(), setting, "recipient@example.com"); err != nil {
		t.Fatalf("sending test email: %v", err)
	}

	server.mu.Lock()
	mailFrom, rcptTo, message := server.mailFrom, server.rcptTo, server.message
	server.mu.Unlock()
	if mailFrom != "sender@example.com" {
		t.Errorf("MAIL FROM = %q, want sender@example.com", mailFrom)
	}
	if rcptTo != "recipient@example.com" {
		t.Errorf("RCPT TO = %q, want recipient@example.com", rcptTo)
	}
	parsed, err := mail.ReadMessage(strings.NewReader(message))
	if err != nil {
		t.Fatalf("parsing delivered message: %v", err)
	}
	from, err := mail.ParseAddress(parsed.Header.Get("From"))
	if err != nil || from.Name != "Kite Sender" || from.Address != "sender@example.com" {
		t.Errorf("From = %q, parsed as %#v, error = %v", parsed.Header.Get("From"), from, err)
	}
	if got := parsed.Header.Get("To"); got != "recipient@example.com" {
		t.Errorf("To = %q", got)
	}
	if got := parsed.Header.Get("Subject"); got != "Kite SMTP test email" {
		t.Errorf("Subject = %q", got)
	}
}

func TestSendSMTPTestEmailFailsWhenStartTLSIsUnsupported(t *testing.T) {
	server := newFakeSMTPServer(t, false, true)
	setting := server.setting()
	setting.SMTPEncryption = "starttls"

	err := sendSMTPTestEmail(context.Background(), setting, "recipient@example.com")
	if err == nil || !strings.Contains(err.Error(), "does not support STARTTLS") {
		t.Fatalf("error = %v, want STARTTLS unsupported error", err)
	}
}

func TestSendSMTPTestEmailRejectsAuthenticationOrRecipient(t *testing.T) {
	tests := []struct {
		name       string
		rejectAuth bool
		rejectRcpt bool
		configure  func(*model.GeneralSetting)
		want       string
	}{
		{
			name:       "authentication",
			rejectAuth: true,
			configure: func(setting *model.GeneralSetting) {
				setting.SMTPUsername = "username"
				setting.SMTPPassword = model.SecretString("password")
			},
			want: "authenticate SMTP client",
		},
		{
			name:       "recipient",
			rejectRcpt: true,
			configure:  func(*model.GeneralSetting) {},
			want:       "set SMTP recipient",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newFakeSMTPServer(t, tt.rejectAuth, tt.rejectRcpt)
			setting := server.setting()
			tt.configure(setting)

			err := sendSMTPTestEmail(context.Background(), setting, "recipient@example.com")
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestHandleUpdateGeneralSettingReplacesAndClearsSMTPPassword(t *testing.T) {
	setupGeneralSettingTestDB(t, "")
	if err := model.DB.Model(&model.GeneralSetting{}).Where("id = ?", 1).Update("smtp_password", model.SecretString("old-password")).Error; err != nil {
		t.Fatalf("storing SMTP password: %v", err)
	}
	router := generalSettingTestRouter()

	replaceResponse := performGeneralSettingRequest(t, router, "PUT", `{"smtpPassword":" new-password "}`)
	if replaceResponse.Code != 200 || strings.Contains(replaceResponse.Body.String(), "new-password") {
		t.Fatalf("replace response = %d: %s", replaceResponse.Code, replaceResponse.Body.String())
	}
	var stored model.GeneralSetting
	if err := model.DB.First(&stored, 1).Error; err != nil {
		t.Fatalf("loading replaced setting: %v", err)
	}
	if stored.SMTPPassword != model.SecretString("new-password") {
		t.Fatalf("stored SMTP password = %q, want replaced value", stored.SMTPPassword)
	}

	clearResponse := performGeneralSettingRequest(t, router, "PUT", `{"smtpPassword":"ignored-password","smtpClearPassword":true}`)
	if clearResponse.Code != 200 || strings.Contains(clearResponse.Body.String(), "ignored-password") {
		t.Fatalf("clear response = %d: %s", clearResponse.Code, clearResponse.Body.String())
	}
	if err := model.DB.First(&stored, 1).Error; err != nil {
		t.Fatalf("loading cleared setting: %v", err)
	}
	if stored.SMTPPassword != "" {
		t.Fatalf("stored SMTP password = %q, want empty", stored.SMTPPassword)
	}
}
