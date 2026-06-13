import ast
import os

def chunk_python_file(filepath):
    """
    Reads a .py file and splits it into chunks — one chunk per function.
    Returns a list of dicts with the chunk text and metadata.
    """
    with open(filepath, 'r') as f:
        source_code = f.read()

    chunks = []

    try:
        tree = ast.parse(source_code)
    except SyntaxError:
        print(f"Skipping {filepath} — syntax error")
        return []

    lines = source_code.split('\n')

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start_line = node.lineno - 1        # ast is 1-indexed
            end_line = node.end_lineno          # end_lineno is inclusive

            # Extract the function's source lines
            function_code = '\n'.join(lines[start_line:end_line])

            chunks.append({
                "text": function_code,
                "file": filepath,
                "function_name": node.name,
                "start_line": node.lineno,
                "end_line": node.end_lineno,
            })

    return chunks


def chunk_repository(repo_path):
    """
    Walks an entire folder, chunks every .py file it finds.
    Returns all chunks combined.
    """
    all_chunks = []

    for root, dirs, files in os.walk(repo_path):
        # Skip hidden folders like .git
        dirs[:] = [d for d in dirs if not d.startswith('.')]

        for file in files:
            if file.endswith('.py'):
                filepath = os.path.join(root, file)
                chunks = chunk_python_file(filepath)
                all_chunks.extend(chunks)
                print(f"  Chunked {filepath} → {len(chunks)} functions")

    return all_chunks


# Test it
if __name__ == "__main__":
    print("Chunking sample_repo...\n")
    chunks = chunk_repository("sample_repo")

    print(f"\nTotal chunks found: {len(chunks)}\n")
    print("=" * 50)

    # Print each chunk
    for chunk in chunks:
        print(f"\nFunction: {chunk['function_name']}")
        print(f"File: {chunk['file']}")
        print(f"Lines: {chunk['start_line']} → {chunk['end_line']}")
        print(f"Code:\n{chunk['text']}")
        print("-" * 40)