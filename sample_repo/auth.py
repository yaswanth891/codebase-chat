import bcrypt
import jwt

def authenticate_user(username, password, db):
    user = db.find_user(username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode(), hashed_password)

def hash_password(password):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt)

def generate_jwt_token(user_id, secret_key):
    payload = {"user_id": user_id}
    return jwt.encode(payload, secret_key, algorithm="HS256")

def decode_jwt_token(token, secret_key):
    return jwt.decode(token, secret_key, algorithms=["HS256"])