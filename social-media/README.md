# Arena Social Media Automation System

## Overview

Complete automation system for managing Arena's presence across all major social platforms. Integrates with CI/CD pipeline to automatically post updates, announcements, and tournament results.

## Features

- **Multi-Platform Support**: Discord, Facebook, Twitter/X, Instagram, Reddit, YouTube
- **Automated Posting**: Triggers on GitHub events (push, release, PR merge)
- **Content Templates**: Platform-specific content formatting
- **CI/CD Integration**: GitHub Actions workflow
- **Discord Server Management**: Automated server setup and channel creation

## Quick Setup

### 1. Install Dependencies
```bash
cd social-media
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Create `.env` file with:
```env
DISCORD_BOT_TOKEN=your_discord_bot_token
FACEBOOK_ACCESS_TOKEN=your_facebook_token
FACEBOOK_PAGE_ID=your_page_id
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_ACCESS_TOKEN=your_twitter_access_token
TWITTER_ACCESS_SECRET=your_twitter_access_secret
INSTAGRAM_ACCESS_TOKEN=your_instagram_token
REDDIT_CLIENT_ID=your_reddit_client_id
REDDIT_CLIENT_SECRET=your_reddit_client_secret
YOUTUBE_API_KEY=your_youtube_api_key
```

### 3. Setup Discord Server
```bash
python discord-setup.py
```

### 4. Test Automation
```bash
python auto_post.py --event push --test
```

## Platform Setup Guides

### Discord Setup
1. Create Discord application at https://discord.com/developers/applications
2. Create bot and get token
3. Invite bot to server with proper permissions
4. Run `python discord-setup.py` to create channels

### Facebook Setup
1. Create Facebook Page for Arena
2. Create Facebook App with Page access token
3. Add `FACEBOOK_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID` to environment

### Twitter/X Setup
1. Apply for Twitter Developer Account
2. Create App with Read/Write permissions
3. Generate API keys and access tokens
4. Add all Twitter credentials to environment

### Instagram Setup
1. Convert to Instagram Business Account
2. Link to Facebook Page
3. Use Facebook Graph API for posting
4. Add `INSTAGRAM_ACCESS_TOKEN` to environment

### Reddit Setup
1. Create Reddit account for Arena
2. Create subreddit r/ArenaGaming
3. Create Reddit App (script type)
4. Add client ID and secret to environment

### YouTube Setup
1. Create YouTube Channel
2. Enable YouTube Data API v3
3. Create API key
4. Add to environment

## Content Templates

Templates are defined in `content_templates.json` for different event types:

- `push_update`: Code deployment notifications
- `release_announcement`: New version releases
- `feature_update`: New feature announcements
- `tournament_announcement`: Tournament promotions
- `platform_update`: General platform updates
- `security_update`: Security notifications
- `maintenance_notice`: Downtime notifications
- `community_highlight`: Player achievements
- `bug_fix_announcement`: Bug fix releases

## CI/CD Integration

The system automatically triggers on:
- **Push to main**: Posts code updates
- **New release**: Posts release announcements
- **Merged PR**: Posts feature updates

## Usage Examples

### Manual Posting
```bash
# Post tournament announcement
python auto_post.py --event tournament_announcement --data '{"name":"Summer Championship","prize":"$1000","time":"2:00 PM EST","game":"CS2","format":"5v5"}'

# Post platform update
python auto_post.py --event platform_update --data '{"feature":"Match Replay System","description":"Watch and share your best matches"}'
```

### Test Mode
```bash
# Test without actually posting
python auto_post.py --event push --test
```

## Security Considerations

- All API tokens stored as GitHub Secrets
- Rate limiting implemented for all platforms
- Content validation and sanitization
- Error handling and retry logic

## Monitoring and Analytics

- Post success/failure logging
- Engagement tracking (platform-specific)
- Content performance metrics
- Automated error reporting

## Troubleshooting

### Common Issues
1. **Discord Bot Permissions**: Ensure bot has proper permissions
2. **API Rate Limits**: Built-in retry logic handles most cases
3. **Image Posting**: Instagram requires images, other platforms optional
4. **Content Length**: Twitter has 280 character limit

### Debug Mode
```bash
# Enable debug logging
export DEBUG=true
python auto_post.py --event push --test
```

## Content Guidelines

### Brand Voice
- Energetic and competitive
- Professional yet approachable
- Gaming-focused terminology
- Consistent neon/cyberpunk aesthetic

### Posting Schedule
- **Daily**: General updates and community content
- **Weekly**: Tournament announcements and results
- **Event-driven**: Platform updates and releases
- **Real-time**: Live tournament coverage

## Customization

### Adding New Platforms
1. Add API client setup in `auto_post.py`
2. Add platform to content templates
3. Add posting method to `post_to_all_platforms`
4. Update requirements.txt

### Modifying Templates
Edit `content_templates.json` to customize content for each platform.

### Adding Event Types
1. Create new template in `content_templates.json`
2. Add handler method in `auto_post.py`
3. Update CI/CD workflow if needed

## Deployment

1. **Setup**: Configure all API keys and tokens
2. **Test**: Run test mode to verify configuration
3. **Deploy**: Merge to main branch to activate automation
4. **Monitor**: Check GitHub Actions logs for issues

## Support

For issues or questions:
1. Check GitHub Actions logs
2. Review debug output
3. Verify API credentials
4. Check platform-specific documentation

---

**Note**: This system is designed for automated operation but includes manual override capabilities for urgent communications.
