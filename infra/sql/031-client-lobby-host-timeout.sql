-- Auto-cancel waiting lobbies when host desktop client is silent (Engine reads this key).
INSERT INTO platform_config (key, value) VALUES
    ('client_lobby_host_timeout_sec', '60')
ON CONFLICT (key) DO NOTHING;
