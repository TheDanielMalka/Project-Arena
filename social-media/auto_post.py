#!/usr/bin/env python3
"""
Arena Social Media Automation Bot
Handles automated posting to all social platforms based on CI/CD events
"""

import os
import json
import asyncio
import argparse
from datetime import datetime
from typing import Dict, Any

# Social Media APIs
import tweepy
import facebook
import praw
import discord
from discord.ext import commands
import requests

class SocialMediaAutomator:
    def __init__(self):
        self.load_templates()
        self.setup_apis()
    
    def load_templates(self):
        """Load content templates from JSON file"""
        template_path = os.path.join(os.path.dirname(__file__), 'content_templates.json')
        with open(template_path, 'r') as f:
            self.templates = json.load(f)
    
    def setup_apis(self):
        """Initialize all social media API clients"""
        # Discord
        self.discord_token = os.getenv("DISCORD_BOT_TOKEN")
        
        # Facebook
        self.facebook_token = os.getenv("FACEBOOK_ACCESS_TOKEN")
        self.facebook_page_id = os.getenv("FACEBOOK_PAGE_ID")
        
        # Twitter/X
        self.twitter_api_key = os.getenv("TWITTER_API_KEY")
        self.twitter_api_secret = os.getenv("TWITTER_API_SECRET")
        self.twitter_access_token = os.getenv("TWITTER_ACCESS_TOKEN")
        self.twitter_access_secret = os.getenv("TWITTER_ACCESS_SECRET")
        
        # Instagram
        self.instagram_token = os.getenv("INSTAGRAM_ACCESS_TOKEN")
        
        # Reddit
        self.reddit_client_id = os.getenv("REDDIT_CLIENT_ID")
        self.reddit_client_secret = os.getenv("REDDIT_CLIENT_SECRET")
        self.reddit_user_agent = "Arena Platform Bot v1.0"
        
        # YouTube
        self.youtube_api_key = os.getenv("YOUTUBE_API_KEY")
    
    async def post_to_discord(self, content: str, channel_name: str = "announcements"):
        """Post message to Discord channel"""
        if not self.discord_token:
            print("Discord token not configured")
            return
        
        intents = discord.Intents.default()
        bot = commands.Bot(command_prefix='!arena', intents=intents)
        
        @bot.event
        async def on_ready():
            guild = bot.guilds[0] if bot.guilds else None
            if guild:
                channel = discord.utils.get(guild.text_channels, name=channel_name)
                if channel:
                    await channel.send(content)
                    print(f"Posted to Discord #{channel_name}")
            await bot.close()
        
        await bot.start(self.discord_token)
    
    def post_to_facebook(self, content: str, image_url: str = None):
        """Post to Facebook page"""
        if not self.facebook_token:
            print("Facebook token not configured")
            return
        
        graph = facebook.GraphAPI(access_token=self.facebook_token)
        
        post_data = {'message': content}
        if image_url:
            post_data['url'] = image_url
        
        try:
            post = graph.put_object(
                parent_object=self.facebook_page_id,
                connection_name='feed',
                **post_data
            )
            print(f"Posted to Facebook: {post['id']}")
        except Exception as e:
            print(f"Facebook posting failed: {e}")
    
    def post_to_twitter(self, content: str, image_url: str = None):
        """Post to Twitter/X"""
        if not all([self.twitter_api_key, self.twitter_api_secret, 
                   self.twitter_access_token, self.twitter_access_secret]):
            print("Twitter credentials not configured")
            return
        
        auth = tweepy.OAuthHandler(self.twitter_api_key, self.twitter_api_secret)
        auth.set_access_token(self.twitter_access_token, self.twitter_access_secret)
        api = tweepy.API(auth)
        
        try:
            if image_url:
                # Download and upload image
                response = requests.get(image_url)
                media = api.media_upload(filename="temp_image.png", file=response.content)
                api.update_status(content, media_ids=[media.media_id])
            else:
                api.update_status(content)
            print("Posted to Twitter")
        except Exception as e:
            print(f"Twitter posting failed: {e}")
    
    def post_to_reddit(self, content: str, subreddit: str = "ArenaGaming"):
        """Post to Reddit"""
        if not all([self.reddit_client_id, self.reddit_client_secret]):
            print("Reddit credentials not configured")
            return
        
        reddit = praw.Reddit(
            client_id=self.reddit_client_id,
            client_secret=self.reddit_client_secret,
            user_agent=self.reddit_user_agent
        )
        
        try:
            subreddit = reddit.subreddit(subreddit)
            submission = subreddit.submit(title="Arena Platform Update", selftext=content)
            print(f"Posted to Reddit: {submission.url}")
        except Exception as e:
            print(f"Reddit posting failed: {e}")
    
    def post_to_instagram(self, content: str, image_url: str):
        """Post to Instagram (requires Facebook Business account)"""
        if not self.instagram_token:
            print("Instagram token not configured")
            return
        
        # Instagram posting requires image
        if not image_url:
            print("Instagram posting requires image URL")
            return
        
        try:
            # Instagram API requires Facebook Graph API
            graph = facebook.GraphAPI(access_token=self.instagram_token)
            
            # Create media object
            media_response = graph.put_object(
                parent_object=self.facebook_page_id,
                connection_name='media',
                image_url=image_url,
                caption=content
            )
            
            # Publish media
            publish_response = graph.put_object(
                parent_object=media_response['id'],
                connection_name='media_publish'
            )
            
            print(f"Posted to Instagram: {publish_response['id']}")
        except Exception as e:
            print(f"Instagram posting failed: {e}")
    
    def generate_content(self, event_type: str, data: Dict[str, Any]) -> Dict[str, str]:
        """Generate platform-specific content from template"""
        if event_type not in self.templates:
            return {}
        
        template = self.templates[event_type]
        content = {}
        
        for platform, template_str in template.items():
            try:
                content[platform] = template_str.format(**data)
            except KeyError as e:
                print(f"Missing template variable for {platform}: {e}")
                content[platform] = template_str
        
        return content
    
    async def handle_github_event(self, event_type: str, event_data: Dict[str, Any]):
        """Handle GitHub webhook events"""
        if event_type == "push":
            await self.handle_push_event(event_data)
        elif event_type == "release":
            await self.handle_release_event(event_data)
        elif event_type == "pull_request":
            await self.handle_pull_request_event(event_data)
    
    async def handle_push_event(self, data: Dict[str, Any]):
        """Handle push to main branch"""
        commits = data.get('commits', [])
        commit_messages = [commit['message'] for commit in commits]
        
        # Generate content for push event
        content_data = {
            "commit_count": len(commits),
            "latest_commit": commit_messages[0] if commit_messages else "No commit message",
            "branch": data.get('ref', '').split('/')[-1],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        content = self.generate_content("push_update", content_data)
        
        # Post to all platforms
        await self.post_to_all_platforms(content, image_url="https://arena.gg/images/update-banner.png")
    
    async def handle_release_event(self, data: Dict[str, Any]):
        """Handle new release"""
        release = data.get('release', {})
        tag_name = release.get('tag_name', 'v1.0.0')
        release_notes = release.get('body', 'New release available!')
        
        content_data = {
            "version": tag_name,
            "release_notes": release_notes[:200] + "..." if len(release_notes) > 200 else release_notes,
            "download_url": "https://arena.gg/download",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        content = self.generate_content("release_announcement", content_data)
        
        # Post to all platforms
        await self.post_to_all_platforms(content, image_url="https://arena.gg/images/release-banner.png")
    
    async def handle_pull_request_event(self, data: Dict[str, Any]):
        """Handle pull request merge"""
        pr = data.get('pull_request', {})
        title = pr.get('title', 'New feature added')
        description = pr.get('body', 'Feature description')
        
        content_data = {
            "feature_title": title,
            "feature_description": description[:150] + "..." if len(description) > 150 else description,
            "pr_number": pr.get('number', 1),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        content = self.generate_content("feature_update", content_data)
        
        # Post to Discord and Reddit (more technical platforms)
        await self.post_to_discord(content.get('discord', ''))
        self.post_to_reddit(content.get('reddit', ''))
    
    async def post_to_all_platforms(self, content: Dict[str, str], image_url: str = None):
        """Post content to all configured platforms"""
        tasks = []
        
        # Discord
        if content.get('discord'):
            tasks.append(self.post_to_discord(content['discord']))
        
        # Facebook
        if content.get('facebook'):
            tasks.append(asyncio.create_task(
                asyncio.to_thread(self.post_to_facebook, content['facebook'], image_url)
            ))
        
        # Twitter
        if content.get('twitter'):
            tasks.append(asyncio.create_task(
                asyncio.to_thread(self.post_to_twitter, content['twitter'], image_url)
            ))
        
        # Instagram
        if content.get('instagram') and image_url:
            tasks.append(asyncio.create_task(
                asyncio.to_thread(self.post_to_instagram, content['instagram'], image_url)
            ))
        
        # Reddit
        if content.get('reddit'):
            tasks.append(asyncio.create_task(
                asyncio.to_thread(self.post_to_reddit, content['reddit'])
            ))
        
        # Execute all posts
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

async def main():
    parser = argparse.ArgumentParser(description='Arena Social Media Automation')
    parser.add_argument('--event', required=True, help='Event type (push, release, pull_request)')
    parser.add_argument('--data', help='Event data JSON file')
    parser.add_argument('--test', action='store_true', help='Test mode - print only')
    
    args = parser.parse_args()
    
    automator = SocialMediaAutomator()
    
    if args.test:
        # Test mode - just print what would be posted
        print("Test mode - would post:")
        if args.event == "push":
            content = automator.generate_content("push_update", {
                "commit_count": 3,
                "latest_commit": "Fix security issues and add new features",
                "branch": "main",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
        elif args.event == "release":
            content = automator.generate_content("release_announcement", {
                "version": "v2.1.0",
                "release_notes": "Major security updates and new tournament features",
                "download_url": "https://arena.gg/download",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
        
        for platform, text in content.items():
            print(f"\n{platform.upper()}:")
            print(text)
    else:
        # Production mode
        event_data = {}
        if args.data:
            with open(args.data, 'r') as f:
                event_data = json.load(f)
        
        await automator.handle_github_event(args.event, event_data)

if __name__ == "__main__":
    asyncio.run(main())
