#!/usr/bin/env python3
"""
Test script to verify all API connections work correctly
"""

import os
import json
import asyncio
from datetime import datetime

# Import the main automator
from auto_post import SocialMediaAutomator

class ConnectionTester:
    def __init__(self):
        self.automator = SocialMediaAutomator()
        self.test_results = {}
    
    def test_discord_connection(self):
        """Test Discord bot connection"""
        print("Testing Discord connection...")
        try:
            if not self.automator.discord_token:
                self.test_results["discord"] = "SKIP - No token configured"
                return
            
            # Try to get bot info
            intents = discord.Intents.default()
            bot = commands.Bot(command_prefix='!test', intents=intents)
            
            @bot.event
            async def on_ready():
                print(f"Discord bot connected: {bot.user}")
                self.test_results["discord"] = "SUCCESS - Bot connected"
                await bot.close()
            
            # Run with timeout
            asyncio.create_task(bot.start(self.automator.discord_token))
            asyncio.sleep(5)
            
        except Exception as e:
            self.test_results["discord"] = f"FAILED - {str(e)}"
    
    def test_facebook_connection(self):
        """Test Facebook API connection"""
        print("Testing Facebook connection...")
        try:
            if not all([self.automator.facebook_token, self.automator.facebook_page_id]):
                self.test_results["facebook"] = "SKIP - No token or page ID configured"
                return
            
            graph = facebook.GraphAPI(access_token=self.automator.facebook_token)
            
            # Try to get page info
            page = graph.get_object(self.automator.facebook_page_id, fields='name')
            self.test_results["facebook"] = f"SUCCESS - Connected to page: {page['name']}"
            
        except Exception as e:
            self.test_results["facebook"] = f"FAILED - {str(e)}"
    
    def test_twitter_connection(self):
        """Test Twitter/X API connection"""
        print("Testing Twitter connection...")
        try:
            if not all([self.automator.twitter_api_key, self.automator.twitter_api_secret,
                       self.automator.twitter_access_token, self.automator.twitter_access_secret]):
                self.test_results["twitter"] = "SKIP - Missing Twitter credentials"
                return
            
            auth = tweepy.OAuthHandler(self.automator.twitter_api_key, self.automator.twitter_api_secret)
            auth.set_access_token(self.automator.twitter_access_token, self.automator.twitter_access_secret)
            api = tweepy.API(auth)
            
            # Try to verify credentials
            user = api.verify_credentials()
            self.test_results["twitter"] = f"SUCCESS - Connected as: @{user.screen_name}"
            
        except Exception as e:
            self.test_results["twitter"] = f"FAILED - {str(e)}"
    
    def test_reddit_connection(self):
        """Test Reddit API connection"""
        print("Testing Reddit connection...")
        try:
            if not all([self.automator.reddit_client_id, self.automator.reddit_client_secret]):
                self.test_results["reddit"] = "SKIP - Missing Reddit credentials"
                return
            
            reddit = praw.Reddit(
                client_id=self.automator.reddit_client_id,
                client_secret=self.automator.reddit_client_secret,
                user_agent=self.automator.reddit_user_agent
            )
            
            # Try to get user info
            user = reddit.user.me()
            self.test_results["reddit"] = f"SUCCESS - Connected as: {user}"
            
        except Exception as e:
            self.test_results["reddit"] = f"FAILED - {str(e)}"
    
    def test_templates_loading(self):
        """Test that content templates load correctly"""
        print("Testing content templates...")
        try:
            if not self.automator.templates:
                self.test_results["templates"] = "FAILED - No templates loaded"
                return
            
            # Test template generation
            content = self.automator.generate_content("push_update", {
                "commit_count": 3,
                "branch": "main",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            
            platforms = ["discord", "twitter", "facebook", "instagram", "reddit", "youtube"]
            missing_platforms = []
            
            for platform in platforms:
                if platform not in content or not content[platform]:
                    missing_platforms.append(platform)
            
            if missing_platforms:
                self.test_results["templates"] = f"PARTIAL - Missing templates for: {', '.join(missing_platforms)}"
            else:
                self.test_results["templates"] = f"SUCCESS - All {len(platforms)} platforms have templates"
                
        except Exception as e:
            self.test_results["templates"] = f"FAILED - {str(e)}"
    
    def run_all_tests(self):
        """Run all connection tests"""
        print("=" * 50)
        print("ARENA SOCIAL MEDIA - CONNECTION TESTS")
        print("=" * 50)
        
        self.test_templates_loading()
        self.test_discord_connection()
        self.test_facebook_connection()
        self.test_twitter_connection()
        self.test_reddit_connection()
        
        print("\n" + "=" * 50)
        print("TEST RESULTS:")
        print("=" * 50)
        
        for service, result in self.test_results.items():
            status = "SUCCESS" in result
            icon = "PASS" if status else "FAIL"
            print(f"{icon} {service.upper()}: {result}")
        
        # Summary
        successful = sum(1 for result in self.test_results.values() if "SUCCESS" in result)
        total = len(self.test_results)
        
        print(f"\nSummary: {successful}/{total} tests passed")
        
        if successful == total:
            print("All systems ready! You can proceed with real posting.")
        else:
            print("Some issues found. Please fix before enabling real posting.")

if __name__ == "__main__":
    tester = ConnectionTester()
    tester.run_all_tests()
