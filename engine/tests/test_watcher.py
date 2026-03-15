import pytest
from unittest.mock import MagicMock, patch, call

from src.vision.watcher import ScreenshotHandler
from src.vision.engine import VisionEngineOutput


# ─── helpers ────────────────────────────────────────────────────────────────

def make_event(src_path: str, is_directory: bool = False) -> MagicMock:

    event = MagicMock()
    event.src_path = src_path
    event.is_directory = is_directory
    return event


def make_output(accepted: bool, result="victory", confidence=0.95, players=None) -> VisionEngineOutput:

    return VisionEngineOutput(
        result=result,
        confidence=confidence,
        players=players or ["player1", "player2"],
        accepted=accepted,
    )


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def engine():
    mock = MagicMock()
    mock.config.cooldown_seconds = 0
    return mock


@pytest.fixture
def handler(engine):
    return ScreenshotHandler(engine)


# ─── tests ───────────────────────────────────────────────────────────────────

class TestIgnoredEvents:

    def test_ignores_directory_event(self, handler, engine):
        event = make_event("screenshots/CS2/somefolder", is_directory=True)

        with patch("time.sleep"):
            handler.on_created(event)

        engine.process_frame.assert_not_called()

    def test_ignores_non_png_file(self, handler, engine):
        for filename in ["screenshot.jpg", "screenshot.tmp", "screenshot", "screenshot.PNG.bak"]:
            event = make_event(f"screenshots/CS2/{filename}")

            with patch("time.sleep"):
                handler.on_created(event)

            engine.process_frame.assert_not_called()


class TestProcessFrameCalled:

    def test_calls_process_frame_with_correct_path(self, handler, engine):

        engine.process_frame.return_value = make_output(accepted=True)
        event = make_event("screenshots/CS2/match_001.png")

        with patch("time.sleep"):
            handler.on_created(event)

        engine.process_frame.assert_called_once_with("screenshots/CS2/match_001.png")

    def test_sleep_called_before_process(self, handler, engine):

        engine.process_frame.return_value = make_output(accepted=True)
        event = make_event("screenshots/CS2/match_001.png")

        with patch("time.sleep") as mock_sleep:
            handler.on_created(event)

        mock_sleep.assert_called_once_with(0.3)


class TestErrorHandling:

    def test_does_not_raise_on_exception(self, handler, engine):

        engine.process_frame.side_effect = ValueError("corrupt image")
        event = make_event("screenshots/CS2/bad_file.png")

        with patch("time.sleep"):
            handler.on_created(event)  


class TestOutput:

    def test_prints_result_when_accepted(self, handler, engine, capsys):

        engine.process_frame.return_value = make_output(
            accepted=True,
            result="victory",
            confidence=0.95,
            players=["player1", "player2"],
        )
        event = make_event("screenshots/CS2/match_001.png")

        with patch("time.sleep"):
            handler.on_created(event)

        output = capsys.readouterr().out
        assert "victory" in output
        assert "player1" in output

    def test_prints_no_confidence_when_not_accepted(self, handler, engine, capsys):

        engine.process_frame.return_value = make_output(
            accepted=False,
            confidence=0.4,
        )
        event = make_event("screenshots/CS2/low_conf.png")

        with patch("time.sleep"):
            handler.on_created(event)

        output = capsys.readouterr().out
        assert "no confidence" in output
