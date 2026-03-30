import pytesseract
import cv2
import numpy as np
import os
import logging
import re
import time
from logging.handlers import RotatingFileHandler


LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

logger = logging.getLogger("vision.ocr")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.DEBUG)
console_handler.setFormatter(formatter)

file_handler = RotatingFileHandler(
    os.path.join(LOG_DIR, "ocr.log"),
    maxBytes=500000,
    backupCount=3
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)

logger.addHandler(console_handler)
logger.addHandler(file_handler)


# ── Region constants ──────────────────────────────────────────────────────────

# CS2: player names appear in a thin row near the very bottom of the scoreboard
NAME_ROW_Y = 0.85
NAME_ROW_H = 0.06

# Valorant: end-screen layout
#
#   ┌─────────────────────────────────────────────────────────────────────────┐
#   │  "13"  (left corner y 2-15%)          "11" (right corner y 2-15%)      │
#   │                    *** VICTORY ***  /  *** DEFEAT ***                   │
#   │                    (large text, y ≈ 5-35%)                              │
#   ├──────────┬──────────┬──────────┬──────────┬──────────┤                  │
#   │BRIMSTONE │  SAGE    │  JETT    │  OMEN    │ PHOENIX  │  ← agent/title  │
#   │  DOMA    │ TSACK    │ BOASTER  │ MISTIC   │ PLAYER   │  ← player name  │
#   │  KDA     │  KDA     │  KDA     │  KDA     │  KDA     │                  │
#   └──────────┴──────────┴──────────┴──────────┴──────────┘                  │
#
#   VICTORY cards: agent name (e.g. BRIMSTONE) sits above the player username.
#   DEFEAT  cards: performance title (BLOODHOUND / CLUTCH KING …) replaces the
#                  agent label — same y-position, different content.
#
#   Calibrated from real 1200×675 (16:9) screenshots.  Relative fractions scale
#   correctly to all standard 16:9 and 16:10 resolutions.
#
VAL_AGENT_ROW_Y   = 0.42   # top of agent-name / title row
VAL_AGENT_ROW_H   = 0.09   # height of that row
VAL_PLAYER_ROW_Y  = 0.50   # top of player-username row
VAL_PLAYER_ROW_H  = 0.11   # height of that row

# 5 equal player-card columns (x 2 % – 96 % of screen width)
VAL_SLOT_X_START  = 0.02
VAL_SLOT_X_END    = 0.96
VAL_NUM_SLOTS     = 5
VAL_SLOT_W        = (VAL_SLOT_X_END - VAL_SLOT_X_START) / VAL_NUM_SLOTS   # ≈ 0.188

# Score corners
VAL_SCORE_LEFT_X  = 0.04
VAL_SCORE_LEFT_W  = 0.14
VAL_SCORE_RIGHT_X = 0.82
VAL_SCORE_RIGHT_W = 0.14
VAL_SCORE_Y       = 0.02
VAL_SCORE_H       = 0.13


# ── Tesseract setup ───────────────────────────────────────────────────────────

def _configure_tesseract_path():
    """
    Configure Tesseract executable path on Windows if PATH is not populated.
    This keeps OCR tests/runtime stable across fresh terminal sessions.
    """
    if os.name != "nt":
        return

    default_windows_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]

    for tesseract_path in default_windows_paths:
        if os.path.exists(tesseract_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
            logger.info(f"using tesseract binary: {tesseract_path}")
            return

    logger.warning("tesseract.exe not found in default Windows paths")


_configure_tesseract_path()


# ── Image preprocessing ───────────────────────────────────────────────────────

def preprocess_image(img, invert=True):
    """
    Convert BGR image to a binary image suitable for Tesseract.

    Pipeline:
      1. Grayscale
      2. Gaussian blur (denoise)
      3. 3x upscale (Tesseract accuracy improves with larger text)
      4. Optional invert  (use invert=True for white-text-on-dark backgrounds)
      5. Binary threshold at 180
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    logger.debug(f"converted to grayscale: {gray.shape}")

    scaled = cv2.resize(gray, (gray.shape[1] * 3, gray.shape[0] * 3))
    logger.debug(f"upscaled 3x: {scaled.shape}")

    if invert:
        scaled = cv2.bitwise_not(scaled)
        logger.debug("inverted colours")

    _, binary = cv2.threshold(scaled, 180, 255, cv2.THRESH_BINARY)
    logger.debug("applied binary threshold")

    return binary


# ── Generic text extractor ────────────────────────────────────────────────────

def extract_text(image_path, region=None, invert=True):
    """
    Run Tesseract on *image_path* and return the raw text string.

    Args:
        image_path : Path to the screenshot.
        region     : (x, y, w, h) crop; when None uses the CS2 player-name
                     row as the default crop (legacy behaviour).
        invert     : Whether to invert before thresholding.

    Returns:
        Stripped text string, or None if the file does not exist.
    """
    logger.info(f"extracting text from: {image_path}")
    start_time = time.perf_counter()

    if not os.path.exists(image_path):
        logger.error(f"image file not found: {image_path}")
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.info(f"extract_text elapsed: {elapsed_ms:.2f}ms (file missing)")
        return None

    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        img = img[y:y + h, x:x + w]
        logger.info(f"cropped region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        x1 = int(w * 0.02)
        y1 = int(h * NAME_ROW_Y)
        w1 = int(w * 0.96)
        h1 = int(h * NAME_ROW_H)
        img = img[y1:y1 + h1, x1:x1 + w1]
        logger.info(f"using default region (CS2 player-names row): x={x1}, y={y1}, w={w1}, h={h1}")

    processed = preprocess_image(img, invert=invert)

    text = pytesseract.image_to_string(processed, config="--psm 6")
    logger.info(f"raw OCR output: {text.strip()}")
    elapsed_ms = (time.perf_counter() - start_time) * 1000
    logger.info(f"extract_text elapsed: {elapsed_ms:.2f}ms")

    return text.strip()


# ── CS2 extractors ────────────────────────────────────────────────────────────

def _extract_player_names_cs2(image_path: str, region=None, invert=True) -> list[str]:
    """
    CS2: player names sit in a thin row at ~85 % of the scoreboard height.
    Returns a cleaned list of username strings.
    """
    logger.info("[CS2] extracting player names from scoreboard")
    raw_text = extract_text(image_path, region, invert=invert)

    if not raw_text:
        logger.warning("[CS2] no text extracted from image")
        return []

    cleaned = raw_text.replace("|", " ")
    cleaned = re.sub(r"[^a-zA-Z0-9_\-\s]", "", cleaned)

    names = []
    for word in cleaned.split():
        word = word.strip("-_ ")
        if len(word) < 3:
            continue
        if word.isdigit():
            continue
        names.append(word)

    logger.info(f"[CS2] extracted {len(names)} player names: {names}")
    return names


def _extract_score_cs2(image_path: str, region=None, invert=True) -> str | None:
    """
    CS2: score is displayed as a single "16-14" or "16:14" pattern near the
    top-centre of the scoreboard.
    """
    logger.info(f"[CS2] extracting score from: {image_path}")
    raw_text = extract_text(image_path, region, invert=invert)

    if not raw_text:
        logger.warning("[CS2] no text extracted for score")
        return None

    score_pattern = re.compile(r'(\d{1,2})\s*[-:]\s*(\d{1,2})')
    match = score_pattern.search(raw_text)

    if match:
        score = f"{match.group(1)}-{match.group(2)}"
        logger.info(f"[CS2] score detected: {score}")
        return score

    logger.warning("[CS2] no score pattern found in text")
    return None


# ── Valorant extractors ───────────────────────────────────────────────────────

def _extract_player_names_valorant(image_path: str, region=None, invert=True) -> list[str]:
    """
    Valorant: player usernames appear in large white text inside each agent
    card, at roughly 50-61 % of the screen height.

    Returns a cleaned list of up to 5 username strings (one per player).
    """
    logger.info("[Valorant] extracting player usernames from end-screen cards")

    if not os.path.exists(image_path):
        logger.error(f"[Valorant] image file not found: {image_path}")
        return []

    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        crop = img[y:y + h, x:x + w]
        logger.info(f"[Valorant] custom player-row region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        y1 = int(h * VAL_PLAYER_ROW_Y)
        h1 = int(h * VAL_PLAYER_ROW_H)
        x1 = int(w * 0.02)
        w1 = int(w * 0.96)
        crop = img[y1:y1 + h1, x1:x1 + w1]
        logger.info(f"[Valorant] default player-row region: y={y1}, h={h1}")

    processed = preprocess_image(crop, invert=invert)
    raw_text = pytesseract.image_to_string(processed, config="--psm 6")
    logger.info(f"[Valorant] raw player OCR: {raw_text.strip()}")

    cleaned = raw_text.replace("|", " ")
    cleaned = re.sub(r"[^a-zA-Z0-9_\-\s]", "", cleaned)

    names = []
    for word in cleaned.split():
        word = word.strip("-_ ")
        if len(word) < 2:
            continue
        if word.isdigit():
            continue
        names.append(word)

    logger.info(f"[Valorant] extracted {len(names)} player names: {names}")
    return names


def _extract_score_valorant(image_path: str, region=None, invert=True) -> str | None:
    """
    Valorant: the two round scores appear in opposite corners at the very top.
      - left  corner  (~x 4-18 %): winning team score
      - right corner  (~x 82-96 %): losing team score

    Extracts each corner separately, then combines as "left-right".

    TODO: wire to DB once match model stores per-team round counts.
    """
    logger.info(f"[Valorant] extracting score from: {image_path}")

    if not os.path.exists(image_path):
        logger.error(f"[Valorant] image file not found: {image_path}")
        return None

    img = cv2.imread(image_path)
    h, w = img.shape[:2]

    y1 = int(h * VAL_SCORE_Y)
    h1 = int(h * VAL_SCORE_H)

    # Left score corner
    lx = int(w * VAL_SCORE_LEFT_X)
    lw = int(w * VAL_SCORE_LEFT_W)
    left_crop = img[y1:y1 + h1, lx:lx + lw]
    left_proc = preprocess_image(left_crop, invert=invert)
    left_text = pytesseract.image_to_string(left_proc, config="--psm 8 -c tessedit_char_whitelist=0123456789")

    # Right score corner
    rx = int(w * VAL_SCORE_RIGHT_X)
    rw = int(w * VAL_SCORE_RIGHT_W)
    right_crop = img[y1:y1 + h1, rx:rx + rw]
    right_proc = preprocess_image(right_crop, invert=invert)
    right_text = pytesseract.image_to_string(right_proc, config="--psm 8 -c tessedit_char_whitelist=0123456789")

    left_num  = re.search(r'\d{1,2}', left_text)
    right_num = re.search(r'\d{1,2}', right_text)

    if left_num and right_num:
        score = f"{left_num.group()}-{right_num.group()}"
        logger.info(f"[Valorant] score detected: {score}")
        return score

    # Fallback: try to read both numbers from one wide top strip
    logger.debug("[Valorant] corner extraction failed, trying full-top fallback")
    full_top = img[y1:y1 + h1, 0:w]
    full_proc = preprocess_image(full_top, invert=invert)
    full_text = pytesseract.image_to_string(full_proc, config="--psm 6")
    nums = re.findall(r'\d{1,2}', full_text)

    if len(nums) >= 2:
        score = f"{nums[0]}-{nums[1]}"
        logger.info(f"[Valorant] score (fallback): {score}")
        return score

    logger.warning("[Valorant] could not extract score")
    return None


# ── Valorant: agent names extractor ──────────────────────────────────────────

def extract_agents(image_path: str, region=None, invert=True) -> list[str]:
    """
    Valorant-only.  Extracts the agent names (BRIMSTONE, JETT, SAGE …)
    from the small label that appears above each player card at ~42-51 %
    of the screen height.

    Returns a list of detected agent-name strings (up to 5 for a standard
    5v5 match).  An empty list is returned for any error.

    Note: this function is Valorant-specific and has no CS2 equivalent.
    It is called by VisionEngine when game="Valorant" alongside
    extract_player_names() to provide agent context for each player.

    TODO: validate returned strings against KNOWN_VALORANT_AGENTS once the
          agent roster is stable and stored in the DB.
    """
    logger.info("[Valorant] extracting agent names from end-screen")

    if not os.path.exists(image_path):
        logger.error(f"[Valorant] image file not found: {image_path}")
        return []

    img = cv2.imread(image_path)

    if region:
        x, y, w, h = region
        crop = img[y:y + h, x:x + w]
        logger.info(f"[Valorant] custom agent-row region: x={x}, y={y}, w={w}, h={h}")
    else:
        h, w = img.shape[:2]
        y1 = int(h * VAL_AGENT_ROW_Y)
        h1 = int(h * VAL_AGENT_ROW_H)
        x1 = int(w * 0.02)
        w1 = int(w * 0.96)
        crop = img[y1:y1 + h1, x1:x1 + w1]
        logger.info(f"[Valorant] default agent-row region: y={y1}, h={h1}")

    processed = preprocess_image(crop, invert=invert)
    raw_text = pytesseract.image_to_string(processed, config="--psm 6")
    logger.info(f"[Valorant] raw agent OCR: {raw_text.strip()}")

    cleaned = raw_text.replace("|", " ")
    cleaned = re.sub(r"[^a-zA-Z0-9_\-\s/]", "", cleaned)   # keep "/" for KAY/O

    agents = []
    for word in cleaned.split():
        word = word.strip("-_ ")
        if len(word) < 3:
            continue
        if word.isdigit():
            continue
        agents.append(word)

    logger.info(f"[Valorant] extracted {len(agents)} agent names: {agents}")
    return agents


# ── Valorant: per-slot agent + player pair extraction ─────────────────────────

def _clean_ocr_word(raw: str, min_len: int = 2, allow_slash: bool = False) -> str:
    """Strip noise characters from a single OCR token."""
    pattern = r"[^a-zA-Z0-9_\-\s/]" if allow_slash else r"[^a-zA-Z0-9_\-\s]"
    cleaned = re.sub(pattern, "", raw).strip("-_ ")
    return cleaned


def _ocr_slot(img: np.ndarray, row_y: float, row_h: float,
              slot_x: float, slot_w: float, invert: bool,
              psm: int = 7) -> str:
    """
    Run Tesseract on a single player-card row × column intersection.

    Args:
        img    : full end-screen image (BGR).
        row_y  : relative y start of the text row (0-1).
        row_h  : relative height of the text row (0-1).
        slot_x : relative x start of this player slot (0-1).
        slot_w : relative width of one slot (0-1).
        invert : True → invert before threshold (white-text-on-dark).
        psm    : Tesseract page-segmentation mode (7 = single line).

    Returns:
        Cleaned OCR string, or "" on failure.
    """
    h, w = img.shape[:2]
    y1 = int(h * row_y)
    y2 = int(h * (row_y + row_h))
    x1 = int(w * slot_x)
    x2 = int(w * (slot_x + slot_w))
    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return ""
    processed = preprocess_image(crop, invert=invert)
    raw = pytesseract.image_to_string(processed,
                                      config=f"--psm {psm}").strip()
    return raw


def _extract_player_agent_pairs_valorant(
        image_path: str,
        invert: bool = True,
) -> list[dict[str, str]]:
    """
    Extract (agent_name, player_name) pairs from a Valorant end-screen by
    splitting the scoreboard into 5 equal player-card columns and running
    OCR independently on each column's agent row and player-name row.

    This per-slot approach guarantees that players[i] and agents[i] in the
    returned list always correspond to the same player — unlike reading the
    full row in one pass, which can lose alignment when OCR skips a word.

    On VICTORY screens the "agent row" contains the actual agent name
    (BRIMSTONE, JETT …).  On DEFEAT screens it contains a performance title
    (BLOODHOUND, CLUTCH KING …).  Both are returned as-is; the caller can
    decide whether the value represents an agent name or a title.

    Returns:
        List of up to 5 dicts: [{"agent": str, "player": str}, …]
        Slots where both fields are empty are omitted from the result.

    TODO: validate agent strings against KNOWN_VALORANT_AGENTS once the
          agent roster is stored in the DB.
    """
    logger.info("[Valorant] extracting per-slot agent+player pairs")

    if not os.path.exists(image_path):
        logger.error(f"[Valorant] image not found: {image_path}")
        return []

    img = cv2.imread(image_path)
    pairs: list[dict[str, str]] = []

    for i in range(VAL_NUM_SLOTS):
        sx = VAL_SLOT_X_START + i * VAL_SLOT_W

        # ── Agent / title row (small caps above the card) ────────────────────
        raw_agent = _ocr_slot(img,
                               row_y=VAL_AGENT_ROW_Y,  row_h=VAL_AGENT_ROW_H,
                               slot_x=sx,              slot_w=VAL_SLOT_W,
                               invert=invert,          psm=7)
        agent = " ".join(
            _clean_ocr_word(tok, min_len=2, allow_slash=True)
            for tok in raw_agent.split()
            if _clean_ocr_word(tok, min_len=2, allow_slash=True)
               and not tok.strip().isdigit()
        )

        # ── Player username row ───────────────────────────────────────────────
        raw_player = _ocr_slot(img,
                                row_y=VAL_PLAYER_ROW_Y, row_h=VAL_PLAYER_ROW_H,
                                slot_x=sx,              slot_w=VAL_SLOT_W,
                                invert=invert,           psm=7)
        # Player names: alphanumeric + underscore/hyphen only (no slash)
        player = " ".join(
            _clean_ocr_word(tok, min_len=2, allow_slash=False)
            for tok in raw_player.split()
            if _clean_ocr_word(tok, min_len=2, allow_slash=False)
               and not tok.strip().isdigit()
        )

        logger.debug(f"[Valorant] slot {i}: agent={agent!r}  player={player!r}")

        if agent or player:
            pairs.append({"agent": agent, "player": player})

    logger.info(f"[Valorant] extracted {len(pairs)} agent+player pairs")
    return pairs


# ── Public API ────────────────────────────────────────────────────────────────

def extract_player_names(image_path: str, region=None, invert=True,
                         game: str = "CS2") -> list[str]:
    """
    Unified player-username extractor.  Routes to the correct game-specific
    implementation based on *game*.

    Args:
        image_path : Path to the end-screen screenshot.
        region     : Optional (x, y, w, h) crop override.
        invert     : Whether to invert before thresholding.
        game       : "CS2" | "Valorant"   (default: "CS2")

    Returns:
        List of player username strings (may be empty if OCR fails).
    """
    logger.info(f"extract_player_names: game={game}, image={image_path}")

    if game == "Valorant":
        return _extract_player_names_valorant(image_path, region, invert)

    # Default -> CS2
    return _extract_player_names_cs2(image_path, region, invert)


def extract_score(image_path: str, region=None, invert=True,
                  game: str = "CS2") -> str | None:
    """
    Unified score extractor.  Routes to the correct game-specific
    implementation based on *game*.

    Args:
        image_path : Path to the end-screen screenshot.
        region     : Optional (x, y, w, h) crop override.
        invert     : Whether to invert before thresholding.
        game       : "CS2" | "Valorant"   (default: "CS2")

    Returns:
        Score string like "13-11" or None if OCR fails.

    TODO: return structured dict {"team_a": int, "team_b": int} once the
          DB match model stores per-team scores separately.
    """
    logger.info(f"extract_score: game={game}, image={image_path}")

    if game == "Valorant":
        return _extract_score_valorant(image_path, region, invert)

    # Default -> CS2
    return _extract_score_cs2(image_path, region, invert)


def extract_agent_player_pairs(image_path: str,
                               invert: bool = True,
                               game: str = "Valorant") -> list[dict[str, str]]:
    """
    Return per-player (agent, player) pairs from a Valorant end-screen.

    Each element is a dict {"agent": str, "player": str} where:
      - "agent"  is the agent name (VICTORY) or performance title (DEFEAT).
      - "player" is the in-game username.

    The i-th element of this list corresponds to the i-th element of the
    players[] and agents[] lists in VisionEngineOutput, so callers can always
    rely on index alignment.

    Args:
        image_path : path to the end-screen screenshot.
        invert     : True → white-text-on-dark preprocessing (Valorant default).
        game       : currently only "Valorant" is supported; returns [] for CS2.

    Returns:
        List of up to 5 dicts, or [] for non-Valorant games / errors.

    TODO: wire game validation against DB match record once match API is live.
    """
    if game != "Valorant":
        logger.debug(f"extract_agent_player_pairs: game={game} — only Valorant supported")
        return []
    return _extract_player_agent_pairs_valorant(image_path, invert=invert)


if __name__ == "__main__":
    # CS2 quick-test (templates commented out until real screenshots are available)
    CS2_IMAGES: list[str] = [
        # "src/vision/templates/cs2/cs2_1920x1080_victory_vertigo.png",
    ]
    for img in CS2_IMAGES:
        result = extract_player_names(img, invert=False, game="CS2")
        print(f"[CS2] {img.split('/')[-1]}: {result}")

    # Valorant quick-test
    VAL_IMAGES: list[str] = [
        # "src/vision/templates/valorant/valorant_1920x1080_victory.png",
    ]
    for img in VAL_IMAGES:
        players = extract_player_names(img, invert=True, game="Valorant")
        agents  = extract_agents(img, invert=True)
        score   = extract_score(img, game="Valorant")
        print(f"[Valorant] {img.split('/')[-1]}: players={players} agents={agents} score={score}")
