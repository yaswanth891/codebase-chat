import psycopg2

def connect_to_database(host, port, dbname, user, password):
    conn = psycopg2.connect(
        host=host, port=port,
        dbname=dbname, user=user, password=password
    )
    return conn

def find_user(conn, username):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
    return cursor.fetchone()

def create_user(conn, username, hashed_password, email):
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO users (username, password, email) VALUES (%s, %s, %s)",
        (username, hashed_password, email)
    )
    conn.commit()

def delete_user(conn, user_id):
    cursor = conn.cursor()
    cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
    conn.commit()