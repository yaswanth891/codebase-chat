import re
import smtplib

def validate_email(email):
    pattern = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    return re.match(pattern, email) is not None

def send_email(to, subject, body, smtp_host, smtp_port):
    server = smtplib.SMTP(smtp_host, smtp_port)
    server.starttls()
    message = f"Subject: {subject}\n\n{body}"
    server.sendmail("noreply@app.com", to, message)
    server.quit()

def format_username(username):
    return username.strip().lower()

def paginate(items, page, page_size):
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end]