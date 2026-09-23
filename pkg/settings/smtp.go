package settings

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/zxh326/kite/pkg/model"
)

const defaultSMTPTimeoutSeconds = 30

func normalizeSMTPEncryption(encryption string) string {
	return strings.ToLower(strings.TrimSpace(encryption))
}

func isSMTPEncryptionSupported(encryption string) bool {
	switch encryption {
	case "none", "starttls", "tls":
		return true
	default:
		return false
	}
}

func isValidEmail(address string) bool {
	parsed, err := mail.ParseAddress(address)
	return err == nil && parsed.Address == address
}

func validateSMTPSetting(setting *model.GeneralSetting) error {
	if !setting.SMTPEnabled {
		return nil
	}
	if setting.SMTPHost == "" {
		return fmt.Errorf("smtpHost is required when smtpEnabled is true")
	}
	if setting.SMTPPort < 1 || setting.SMTPPort > 65535 {
		return fmt.Errorf("smtpPort must be between 1 and 65535 when smtpEnabled is true")
	}
	if !isValidEmail(setting.SMTPFromEmail) {
		return fmt.Errorf("smtpFromEmail must be a valid email address when smtpEnabled is true")
	}
	if !isSMTPEncryptionSupported(setting.SMTPEncryption) {
		return fmt.Errorf("smtpEncryption must be one of none, starttls, tls when smtpEnabled is true")
	}
	return nil
}

func sendSMTPTestEmail(ctx context.Context, setting *model.GeneralSetting, recipient string) error {
	if !setting.SMTPEnabled {
		return fmt.Errorf("SMTP is not enabled")
	}
	if err := validateSMTPSetting(setting); err != nil {
		return err
	}
	if !isValidEmail(recipient) {
		return fmt.Errorf("recipient must be a valid email address")
	}

	timeout := setting.SMTPTimeoutSeconds
	if timeout <= 0 {
		timeout = defaultSMTPTimeoutSeconds
	}
	deadline := time.Now().Add(time.Duration(timeout) * time.Second)
	address := net.JoinHostPort(setting.SMTPHost, strconv.Itoa(setting.SMTPPort))
	tlsConfig := &tls.Config{ServerName: setting.SMTPHost, InsecureSkipVerify: setting.SMTPSkipTLSVerify}
	dialer := &net.Dialer{Timeout: time.Duration(timeout) * time.Second}

	var conn net.Conn
	var err error
	if setting.SMTPEncryption == "tls" {
		conn, err = tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", address)
	}
	if err != nil {
		return fmt.Errorf("connect to SMTP server: %w", err)
	}
	defer func() {
		_ = conn.Close()
	}()
	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set SMTP deadline: %w", err)
	}

	client, err := smtp.NewClient(conn, setting.SMTPHost)
	if err != nil {
		return fmt.Errorf("create SMTP client: %w", err)
	}
	defer func() {
		_ = client.Quit()
	}()

	if setting.SMTPEncryption == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("start SMTP TLS: %w", err)
		}
	}
	if setting.SMTPUsername != "" {
		if err := client.Auth(smtp.PlainAuth("", setting.SMTPUsername, string(setting.SMTPPassword), setting.SMTPHost)); err != nil {
			return fmt.Errorf("authenticate SMTP client: %w", err)
		}
	}
	if err := client.Mail(setting.SMTPFromEmail); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(recipient); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("open SMTP message: %w", err)
	}
	from := (&mail.Address{Name: setting.SMTPFromName, Address: setting.SMTPFromEmail}).String()
	message := "From: " + from + "\r\n" +
		"To: " + recipient + "\r\n" +
		"Subject: Kite SMTP test email\r\n" +
		"\r\n" +
		"This is a test email from Kite.\r\n"
	if _, err := writer.Write([]byte(message)); err != nil {
		return fmt.Errorf("write SMTP message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("send SMTP message: %w", err)
	}
	return nil
}
