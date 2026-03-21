from __future__ import annotations

import logging
from dataclasses import dataclass
from src.identity.database import Player, PlayerDatabase
from src.identity.smurf_detector import SmurfDetector, SmurfDetected

log = logging.getLogger("identity.registration")


@dataclass
class RegistrationResult:
    success: bool
    message: str


def register_player(
    wallet_address: str,
    steam_id: str,
    player_name: str,
    game: str,
    db: PlayerDatabase,
) -> RegistrationResult:
    detector = SmurfDetector(db=db)

    try:
        detector.validate(wallet_address, steam_id)

        player = Player(
            wallet_address=wallet_address,
            steam_id=steam_id,
            player_name=player_name,
            game=game,
        )
        db.add(player)
        log.info("registration success | wallet=%s name=%s", wallet_address, player_name)
        return RegistrationResult(success=True, message="השחקן נרשם בהצלחה")

    except SmurfDetected as e:
        log.warning("registration blocked | %s", e)
        return RegistrationResult(success=False, message=str(e))

    except ValueError as e:
        log.warning("registration failed | %s", e)
        return RegistrationResult(success=False, message=str(e))
