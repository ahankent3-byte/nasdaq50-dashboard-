"""One-time setup: store the Gmail App Password in macOS Keychain.

Run this yourself in Terminal (it prompts securely, nothing is echoed or logged):
    python3 scripts/store_app_password.py
"""

import getpass
import subprocess

GMAIL_ADDRESS = "ahankent3@gmail.com"
KEYCHAIN_SERVICE = "nasdaq50-dashboard-gmail"


def main():
    password = getpass.getpass("Paste your Gmail App Password (input hidden): ").replace(" ", "")
    if len(password) != 16:
        print(f"Warning: Gmail app passwords are usually 16 characters; got {len(password)}. Continuing anyway.")

    subprocess.run(
        ["security", "delete-generic-password", "-a", GMAIL_ADDRESS, "-s", KEYCHAIN_SERVICE],
        capture_output=True,
    )  # ignore failure if it doesn't exist yet
    result = subprocess.run(
        ["security", "add-generic-password", "-a", GMAIL_ADDRESS, "-s", KEYCHAIN_SERVICE, "-w", password],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("Stored successfully in Keychain.")
    else:
        print("Failed to store:", result.stderr)


if __name__ == "__main__":
    main()
