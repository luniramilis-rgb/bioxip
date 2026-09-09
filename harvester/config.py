import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE = os.getenv("SUPABASE_SERVICE_ROLE", "")
OPENALEX_MAIL = os.getenv("OPENALEX_MAIL", "")

EPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"
CT_BASE = "https://clinicaltrials.gov/api/v2"
OPENALEX_BASE = "https://api.openalex.org"
UNPAYWALL_BASE = "https://api.unpaywall.org/v2"

PAGE_SIZE = 1000
CT_PAGE_SIZE = 1000
TIMEOUT = 60.0
MAX_RETRIES = 3
RETRY_BACKOFF = 4.0
DELTA_LOOKBACK_DAYS = int(os.getenv("DELTA_LOOKBACK_DAYS", "7"))
MAX_PAGES_FULL = int(os.getenv("MAX_PAGES_FULL", "300"))
MAX_PAGES_DELTA = int(os.getenv("MAX_PAGES_DELTA", "300"))
STORE_ABSTRACTS = os.getenv("STORE_ABSTRACTS", "false").lower() == "true"
