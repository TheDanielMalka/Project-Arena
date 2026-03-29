import os
import sys
import cv2
import numpy as np
import src.vision.matcher as matcher_module
from src.vision.matcher import match_template, detect_result

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_missing_image():

    matched, confidence, location = match_template(
        "not_exists.jpg",
        "also_not_exists.jpg"
    )
    assert matched == False
    assert confidence == 0.0
    assert location is None

def test_match_found(tmp_path):

    big_img = np.zeros((200, 300), dtype=np.uint8)
    big_img[40:90, 80:130] = 255
    template = big_img[40:90, 80:130].copy()
    
    img_path = str(tmp_path / "big.png")
    tpl_path = str(tmp_path / "template.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)
    
    matched, confidence, location = match_template(img_path, tpl_path)
    
    assert matched == True
    assert confidence >= 0.95
    assert location is not None

def test_match_not_found(tmp_path):
    
    big_img = np.zeros((200, 300), dtype=np.uint8)
    big_img[10:30, 10:30] = 128

    template = np.zeros((50, 50), dtype=np.uint8)
    template[0:25, :] = 255
    template[25:50, :] = 100

    img_path = str(tmp_path / "image.png")
    tpl_path = str(tmp_path / "template.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)

    matched, confidence, location = match_template(img_path, tpl_path)

    assert matched == False
    assert confidence < 0.8

def test_detect_victory(tmp_path):
    img = np.zeros((200, 400, 3), dtype=np.uint8)
    img[24:34, 136:272] = (0, 255, 0)
    img_path = str(tmp_path / "green.png")
    cv2.imwrite(img_path, img)
    result, confidence = detect_result(img_path)
    assert result == "victory"

def test_detect_defeat(tmp_path):
    img = np.zeros((200, 400, 3), dtype=np.uint8)
    img[24:34, 136:272] = (0, 0, 255)
    img_path = str(tmp_path / "red.png")
    cv2.imwrite(img_path, img)
    result, confidence = detect_result(img_path)
    assert result == "defeat"

def test_detect_no_result(tmp_path):
    img = np.zeros((200, 400, 3), dtype=np.uint8)
    img_path = str(tmp_path / "black.png")
    cv2.imwrite(img_path, img)
    result, confidence = detect_result(img_path)
    assert result is None

def test_detect_missing_file():
    result, confidence = detect_result("not_exists.jpg")
    assert result is None
    assert confidence == 0.0


def test_match_template_prefers_edge_score_when_higher(tmp_path, monkeypatch):
    big_img = np.zeros((120, 160), dtype=np.uint8)
    big_img[30:80, 50:100] = 255
    template = big_img[30:80, 50:100].copy()

    img_path = str(tmp_path / "edge_pref_big.png")
    tpl_path = str(tmp_path / "edge_pref_tpl.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)

    calls = {"count": 0}

    def fake_match_template(_img, _tpl, _method):
        calls["count"] += 1
        if calls["count"] == 1:
            return np.array([[0.10, 0.20], [0.30, 0.40]], dtype=np.float32)  # base max -> (1,1)
        return np.array([[0.95, 0.20], [0.10, 0.30]], dtype=np.float32)      # edge max -> (0,0)

    monkeypatch.setattr(matcher_module.cv2, "matchTemplate", fake_match_template)

    matched, confidence, location = match_template(img_path, tpl_path, threshold=0.8)

    assert matched is True
    assert confidence == 0.95
    assert location == (0, 0)


def test_match_template_keeps_base_score_when_higher(tmp_path, monkeypatch):
    big_img = np.zeros((120, 160), dtype=np.uint8)
    big_img[30:80, 50:100] = 255
    template = big_img[30:80, 50:100].copy()

    img_path = str(tmp_path / "base_pref_big.png")
    tpl_path = str(tmp_path / "base_pref_tpl.png")
    cv2.imwrite(img_path, big_img)
    cv2.imwrite(tpl_path, template)

    calls = {"count": 0}

    def fake_match_template(_img, _tpl, _method):
        calls["count"] += 1
        if calls["count"] == 1:
            return np.array([[0.10, 0.20], [0.30, 0.91]], dtype=np.float32)  # base max -> (1,1)
        return np.array([[0.50, 0.20], [0.10, 0.30]], dtype=np.float32)      # edge max -> (0,0)

    monkeypatch.setattr(matcher_module.cv2, "matchTemplate", fake_match_template)

    matched, confidence, location = match_template(img_path, tpl_path, threshold=0.8)

    assert matched is True
    assert confidence == 0.91
    assert location == (1, 1)


def test_match_template_logs_elapsed_for_missing_image(caplog):
    caplog.set_level("INFO", logger="vision.matcher")

    matched, confidence, location = match_template("not_exists.jpg", "also_not_exists.jpg")

    assert matched is False
    assert confidence == 0.0
    assert location is None
    assert "match_template elapsed:" in caplog.text


# ── Valorant detect_result tests ─────────────────────────────────────────────

def test_detect_valorant_victory(tmp_path):
    """
    Teal/cyan image in Valorant's VICTORY region -> 'victory'.

    Synthetic image: 400x800, teal BGR (200, 200, 0) inside the default crop
    (y 5-55%, x 10-90%). BGR (200,200,0) -> OpenCV HSV H≈90, inside teal (75-105).
    """
    img = np.zeros((400, 800, 3), dtype=np.uint8)
    # y: 20..220  |  x: 80..720  (matches _detect_result_valorant default crop)
    img[20:180, 100:700] = (200, 200, 0)   # BGR teal -> HSV H≈90
    img_path = str(tmp_path / "valorant_victory.png")
    cv2.imwrite(img_path, img)

    result, confidence = detect_result(img_path, game="Valorant")

    assert result == "victory"
    assert confidence > 0


def test_detect_valorant_defeat(tmp_path):
    """
    Red/crimson fill in Valorant's DEFEAT region -> 'defeat'.

    Matcher uses HSV red bands H 0-8 and H 170-180. BGR (0, 0, 255) is pure red.
    """
    img = np.zeros((400, 800, 3), dtype=np.uint8)
    img[20:180, 100:700] = (0, 0, 255)   # BGR red -> HSV H≈0/180
    img_path = str(tmp_path / "valorant_defeat.png")
    cv2.imwrite(img_path, img)

    result, confidence = detect_result(img_path, game="Valorant")

    assert result == "defeat"
    assert confidence > 0


def test_detect_result_defaults_to_cs2(tmp_path):
    """
    detect_result() with no `game` arg must behave identically to game='CS2'.
    A green image at the CS2 region must be detected as 'victory'.
    """
    img = np.zeros((200, 400, 3), dtype=np.uint8)
    img[24:34, 136:272] = (0, 255, 0)     # BGR green -> CS2 VICTORY
    img_path = str(tmp_path / "default_route.png")
    cv2.imwrite(img_path, img)

    result_default, _ = detect_result(img_path)
    result_explicit, _ = detect_result(img_path, game="CS2")

    assert result_default == "victory"
    assert result_default == result_explicit


def test_detect_valorant_does_not_trigger_on_cs2_green(tmp_path):
    """
    CS2 pure green (BGR 0,255,0 -> HSV H≈60) must NOT be detected as
    Valorant VICTORY (teal range H 75-105). The two colour spaces are
    intentionally separated.
    """
    img = np.zeros((400, 800, 3), dtype=np.uint8)
    img[20:180, 100:700] = (0, 255, 0)    # BGR green -> HSV H≈60, outside teal range
    img_path = str(tmp_path / "cs2_green_in_valorant.png")
    cv2.imwrite(img_path, img)

    result, _ = detect_result(img_path, game="Valorant")

    assert result is None


def test_detect_cs2_does_not_trigger_on_valorant_teal(tmp_path):
    """
    Valorant teal (BGR 200,200,0 -> HSV H≈90) must NOT be detected as
    CS2 VICTORY (green range H 35-85).  H=90 is above the CS2 ceiling.
    """
    img = np.zeros((200, 400, 3), dtype=np.uint8)
    img[24:34, 136:272] = (200, 200, 0)   # BGR teal -> HSV H≈90, outside CS2 green range
    img_path = str(tmp_path / "valorant_teal_in_cs2.png")
    cv2.imwrite(img_path, img)

    result, _ = detect_result(img_path, game="CS2")

    assert result is None


def test_detect_valorant_missing_file():
    """detect_result with game='Valorant' on a missing file returns (None, 0.0)."""
    result, confidence = detect_result("not_exists.png", game="Valorant")
    assert result is None
    assert confidence == 0.0