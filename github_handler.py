import git
import os
import shutil
import stat
import tempfile

def clone_repo(github_url: str) -> str:
    """
    Clones a GitHub repo into a temporary folder.
    Returns the path to the cloned repo.
    """
    # Create a temp folder like /tmp/codebase-chat-abc123
    temp_dir = tempfile.mkdtemp(prefix="codebase-chat-")
    
    print(f"Cloning {github_url}...")
    print(f"Into {temp_dir}...")
    
    try:
        git.Repo.clone_from(github_url, temp_dir)
        print("Clone complete!")
        return temp_dir
    except Exception as e:
        # Clean up if clone fails
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise Exception(f"Failed to clone repo: {str(e)}")


def _onerror_remove_readonly(func, path, exc_info):
    """Error handler for shutil.rmtree to handle read-only files on Windows."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def delete_repo(repo_path: str):
    """
    Deletes the cloned repo folder to free up disk space.
    """
    if os.path.exists(repo_path):
        try:
            shutil.rmtree(repo_path, onerror=_onerror_remove_readonly)
            print(f"Cleaned up {repo_path}")
        except Exception as e:
            print(f"Warning: could not fully delete {repo_path}: {e}")


def get_repo_name(github_url: str) -> str:
    """
    Extracts repo name from URL.
    e.g. https://github.com/tiangolo/fastapi -> fastapi
    """
    clean_url = github_url.strip().rstrip("/")
    if clean_url.endswith(".git"):
        clean_url = clean_url[:-4]
    return clean_url.split("/")[-1]