import pytest
from unittest.mock import MagicMock, patch, call

from src.vision.watcher import ScreenshotHandler, watch
from src.vision.engine import VisionEngine, VisionEngineConfig, VisionEngineOutput


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
    return ScreenshotHandler(engine, wallet_address="0x" + "a" * 40)


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

    def test_prints_detected_when_accepted_once(self, handler, engine, capsys):

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
        assert "detected" in output
        assert "victory" in output

    def test_prints_confirmed_after_three_consecutive(self, handler, engine, capsys):

        engine.process_frame.return_value = make_output(
            accepted=True,
            result="victory",
            confidence=0.95,
            players=["player1", "player2"],
        )
        event = make_event("screenshots/CS2/match_001.png")

        with patch("time.sleep"):
            handler.on_created(event)
            handler.on_created(event)
            handler.on_created(event)

        output = capsys.readouterr().out
        assert "CONFIRMED" in output
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


# ── watch() game-config threading tests ──────────────────────────────────────

class TestWatchGameConfig:
    """
    Verify that watch() correctly seeds VisionEngineConfig with the game
    argument so Valorant screenshots are never processed by the CS2 detector.

    These tests patch watchdog Observer to avoid spawning real FS threads.
    """

    def test_watch_no_config_seeds_cs2_game(self, tmp_path):
        """watch('CS2') with no config creates engine with game='CS2'."""
        created_engines: list[VisionEngine] = []

        original_init = VisionEngine.__init__

        def capture_engine(self, config=None):
            original_init(self, config)
            created_engines.append(self)

        with patch.object(VisionEngine, "__init__", capture_engine), \
             patch("src.vision.watcher.Observer") as mock_obs:
            mock_obs.return_value.start = MagicMock()
            mock_obs.return_value.schedule = MagicMock()
            # Simulate immediate KeyboardInterrupt so watch() exits cleanly
            with patch("time.sleep", side_effect=KeyboardInterrupt):
                try:
                    watch("CS2", screenshots_dir=str(tmp_path))
                except Exception:
                    pass

        assert len(created_engines) == 1
        assert created_engines[0].config.game == "CS2"

    def test_watch_no_config_seeds_valorant_game(self, tmp_path):
        """
        watch('Valorant') with no config must create engine with game='Valorant'.
        This is the critical regression test: before the fix, watch('Valorant')
        would create a CS2 engine (VisionEngineConfig() defaulted to 'CS2').
        """
        created_engines: list[VisionEngine] = []

        original_init = VisionEngine.__init__

        def capture_engine(self, config=None):
            original_init(self, config)
            created_engines.append(self)

        with patch.object(VisionEngine, "__init__", capture_engine), \
             patch("src.vision.watcher.Observer") as mock_obs:
            mock_obs.return_value.start = MagicMock()
            mock_obs.return_value.schedule = MagicMock()
            with patch("time.sleep", side_effect=KeyboardInterrupt):
                try:
                    watch("Valorant", screenshots_dir=str(tmp_path))
                except Exception:
                    pass

        assert len(created_engines) == 1
        assert created_engines[0].config.game == "Valorant"

    def test_watch_explicit_config_is_used_as_is(self, tmp_path):
        """
        When a caller passes an explicit config, watch() must use it unchanged
        (not override config.game with the game argument).
        """
        custom_config = VisionEngineConfig(game="Valorant", confidence_threshold=0.9)
        created_engines: list[VisionEngine] = []

        original_init = VisionEngine.__init__

        def capture_engine(self, config=None):
            original_init(self, config)
            created_engines.append(self)

        with patch.object(VisionEngine, "__init__", capture_engine), \
             patch("src.vision.watcher.Observer") as mock_obs:
            mock_obs.return_value.start = MagicMock()
            mock_obs.return_value.schedule = MagicMock()
            with patch("time.sleep", side_effect=KeyboardInterrupt):
                try:
                    watch("Valorant", screenshots_dir=str(tmp_path),
                          config=custom_config)
                except Exception:
                    pass

        assert len(created_engines) == 1
        assert created_engines[0].config.confidence_threshold == 0.9
        assert created_engines[0].config.game == "Valorant"
