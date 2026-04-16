#!/usr/bin/env python3
"""
Test posting to a single platform only
"""

import os
import asyncio
from auto_post import SocialMediaAutomator

async def test_single_platform(platform: str):
    """Test posting to only one platform"""
    automator = SocialMediaAutomator()
    
    # Generate test content
    content = automator.generate_content("push_update", {
        "commit_count": 1,
        "branch": "test",
        "timestamp": "2026-04-15 20:00:00"
    })
    
    print(f"Testing {platform.upper()} posting...")
    print(f"Content: {content.get(platform, 'No content for this platform')}")
    
    if platform == "discord":
        await automator.post_to_discord(content.get('discord', ''))
    elif platform == "facebook":
        automator.post_to_facebook(content.get('facebook', ''), "https://arena.gg/images/test.png")
    elif platform == "twitter":
        automator.post_to_twitter(content.get('twitter', ''), "https://arena.gg/images/test.png")
    elif platform == "reddit":
        automator.post_to_reddit(content.get('reddit', ''))
    else:
        print(f"Platform {platform} not supported for direct testing")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Test single platform posting')
    parser.add_argument('--platform', required=True, choices=['discord', 'facebook', 'twitter', 'reddit'])
    
    args = parser.parse_args()
    
    asyncio.run(test_single_platform(args.platform))
