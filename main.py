from dotenv import load_dotenv
import os
from google import genai

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Ask Gemini anything. Type 'quit' to exit.\n")

while True:
    question = input("You: ")
    
    if question.lower() == "quit":
        break

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=question
    )

    print(f"Gemini: {response.text}\n")