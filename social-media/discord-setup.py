#!/usr/bin/env python3
"""
Arena Discord Server Setup Bot
Automated Discord server creation and channel configuration
"""

import discord
from discord.ext import commands
import asyncio
import json
import os

class DiscordSetupBot:
    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.messages = True
        
        self.bot = commands.Bot(command_prefix='!arena', intents=intents)
        self.setup_events()
    
    def setup_events(self):
        @self.bot.event
        async def on_ready():
            print(f"Bot logged in as {self.bot.user}")
            await self.setup_server()
        
        @self.bot.command()
        async def setup(ctx):
            """Setup Arena Discord server"""
            await self.setup_server()
    
    async def setup_server(self):
        """Create and configure Discord server"""
        guild = self.bot.guilds[0] if self.bot.guilds else None
        
        if not guild:
            print("No guild found. Please invite bot to server first.")
            return
        
        # Create categories and channels
        categories = {
            "Community": [
                "welcome",
                "announcements", 
                "general-chat",
                "off-topic"
            ],
            "Gaming": [
                "match-lobby",
                "tournaments",
                "cs2-talk",
                "valorant-talk",
                "game-discussion"
            ],
            "Support": [
                "help-desk",
                "bug-reports",
                "feature-requests",
                "technical-support"
            ],
            "Development": [
                "dev-updates",
                "beta-testing",
                "feedback"
            ],
            "VIP": [
                "vip-lounge",
                "exclusive-tournaments",
                "direct-support"
            ]
        }
        
        for category_name, channels in categories.items():
            category = discord.utils.get(guild.categories, name=category_name)
            
            if not category:
                category = await guild.create_category(category_name)
                print(f"Created category: {category_name}")
            
            for channel_name in channels:
                existing = discord.utils.get(category.text_channels, name=channel_name)
                if not existing:
                    await category.create_text_channel(channel_name)
                    print(f"Created channel: {channel_name}")
        
        # Setup welcome channel
        welcome_channel = discord.utils.get(guild.text_channels, name="welcome")
        if welcome_channel:
            await self.setup_welcome_channel(welcome_channel)
        
        # Setup roles
        await self.setup_roles(guild)
        
        # Setup announcements channel rules
        announcements = discord.utils.get(guild.text_channels, name="announcements")
        if announcements:
            await announcements.set_permissions(guild.default_role, send_messages=False)
        
        print("Discord server setup complete!")
    
    async def setup_welcome_channel(self, channel):
        """Setup welcome channel with rules and info"""
        welcome_message = """
# Welcome to Arena Gaming Platform! :tada:

## What is Arena?
- **Competitive Gaming Platform** for CS2, Valorant, and more
- **Automated Match Verification** using AI vision technology
- **Secure Wagering** with blockchain-based escrow
- **Skill-Based Matchmaking** and tournaments

## Quick Start Guide
1. **Verify your account** in #verification
2. **Join tournaments** in #tournaments
3. **Find teammates** in #match-lobby
4. **Get help** in #help-desk

## Server Rules
- Be respectful to all members
- No cheating or hacking discussions
- Keep content gaming-related
- Follow Discord Terms of Service

## Get Started
- Type `!verify` to link your gaming accounts
- Check `!tournaments` for upcoming events
- Use `!help` for command list

**Ready to compete? Join your first tournament!** :crossed_swords:
        """
        
        await channel.purge()
        await channel.send(welcome_message)
    
    async def setup_roles(self, guild):
        """Create server roles"""
        roles = [
            {"name": "Verified Player", "color": discord.Color.blue()},
            {"name": "Tournament Winner", "color": discord.Color.gold()},
            {"name": "VIP Member", "color": discord.Color.purple()},
            {"name": "Moderator", "color": discord.Color.green()},
            {"name": "Developer", "color": discord.Color.red()},
            {"name": "CS2 Player", "color": discord.Color.dark_blue()},
            {"name": "Valorant Player", "color": discord.Color.dark_red()},
        ]
        
        for role_data in roles:
            existing = discord.utils.get(guild.roles, name=role_data["name"])
            if not existing:
                await guild.create_role(
                    name=role_data["name"],
                    color=role_data["color"],
                    mentionable=True
                )
                print(f"Created role: {role_data['name']}")
    
    def run(self, token):
        """Start the bot"""
        self.bot.run(token)

if __name__ == "__main__":
    bot = DiscordSetupBot()
    
    # Load token from environment or file
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        try:
            with open("discord_token.txt", "r") as f:
                token = f.read().strip()
        except FileNotFoundError:
            print("Please set DISCORD_BOT_TOKEN environment variable or create discord_token.txt")
            exit(1)
    
    bot.run(token)
