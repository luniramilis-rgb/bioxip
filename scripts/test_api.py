import httpx


def hit(url: str, params: dict = None) -> None:
    resp = httpx.get(url, params=params, timeout=30)
    print(resp.status_code, url)
    print(resp.text[:500])
    resp.raise_for_status()


if __name__ == "__main__":
    base = "http://localhost:8788"
    hit(f"{base}/api/search", {"q": "tuberculosis"})
    hit(f"{base}/api/sources")
