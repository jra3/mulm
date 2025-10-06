# Mulm - Breeder Awards Program Management

A web application for managing aquarium society Breeder Awards Programs (BAP), tracking breeding achievements, managing member submissions, and handling species data.

**Production**: https://bap.basny.org

## Features

- **Member Management**: User registration, authentication, and profile management
- **Submission System**: Track breeding achievements with photos and detailed information
- **Witness Verification**: Multi-stage verification process for submissions
- **Waiting Period Tracking**: Automatic calculation of species-specific waiting periods
- **Awards & Standings**: Real-time leaderboards and award progression tracking
- **Species Database**: Comprehensive fish, coral, plant, and invertebrate species catalog
- **Admin Tools**: Approval queue, witness management, member administration
- **Image Processing**: Automatic image optimization and multiple size variants
- **Activity Feed**: Real-time updates on submissions, approvals, and achievements

## Tech Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: SQLite with migrations
- **Session Management**: Cookie-based sessions
- **Authentication**: OAuth integration (Google)
- **Email**: Nodemailer for notifications
- **Image Processing**: Sharp for image optimization
- **Storage**: Cloudflare R2 for image storage

### Frontend
- **Template Engine**: Pug templates
- **Interactivity**: HTMX for dynamic updates
- **Styling**: Tailwind CSS with PostCSS
- **Build Tools**: esbuild for bundling

### Infrastructure
- **Hosting**: AWS EC2 (t3.micro)
- **Reverse Proxy**: nginx with Let's Encrypt SSL
- **Deployment**: Docker Compose
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm or yarn
- SQLite3

### Installation

```bash
# Clone the repository
git clone https://github.com/jra3/mulm.git
cd mulm

# Install dependencies
npm install

# Create configuration file
cp src/config.example.json src/config.json
# Edit src/config.json with your settings
```

### Configuration

Create `src/config.json` with the following structure:

```json
{
  "databaseFile": "./database/database.db",
  "sessionSecret": "your-session-secret-here",
  "smtp": {
    "host": "smtp.example.com",
    "port": 587,
    "secure": false,
    "auth": {
      "user": "your-email@example.com",
      "pass": "your-password"
    }
  },
  "oauth": {
    "google": {
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "redirectUri": "http://localhost:4200/auth/google/callback"
    }
  },
  "r2": {
    "accountId": "your-r2-account-id",
    "accessKeyId": "your-access-key",
    "secretAccessKey": "your-secret-key",
    "bucketName": "your-bucket-name",
    "publicUrl": "https://your-bucket.r2.dev"
  }
}
```

### Database Setup

The database is automatically initialized with migrations on first run:

```bash
npm run dev
```

Migrations are located in `db/migrations/` and run automatically at startup.

## Development

### Available Commands

```bash
npm run dev        # Start development server with hot reload
npm run build      # Build TypeScript and PostCSS assets
npm test           # Run test suite
npm test -- --watch # Run tests in watch mode
npm run lint       # Run ESLint
npm run lint:fix   # Fix ESLint issues
npm run script     # Run scripts with ts-node (e.g., npm run script scripts/example.ts)
npm start          # Start production server (requires build first)
```

### Development Server

```bash
npm run dev
```

The server will start on http://localhost:4200 with:
- Hot reload for TypeScript changes (Nodemon)
- Automatic CSS rebuilding (PostCSS watch)
- Source maps for debugging

### Project Structure

```
mulm/
├── db/
│   └── migrations/          # Database migration files
├── infrastructure/          # AWS CDK infrastructure code
├── nginx/                   # nginx configuration for production
├── scripts/                 # Utility scripts
├── src/
│   ├── __tests__/          # Test files
│   ├── db/                 # Database layer (queries, models)
│   ├── forms/              # Zod form validation schemas
│   ├── routes/             # Express route handlers
│   ├── utils/              # Utility functions
│   ├── views/              # Pug templates
│   ├── config.json         # Configuration (git-ignored)
│   └── index.ts            # Application entry point
├── docker-compose.prod.yml # Production Docker Compose
└── package.json
```

## Testing

The project uses Node.js native test runner (migrated from Jest):

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/__tests__/image-processor.test.ts

# Run tests in watch mode
npm test -- --watch
```

**Test Coverage:**
- Unit tests for image processing, validation, and utilities
- Integration tests for witness workflow and database operations
- Template rendering tests for all Pug templates
- Rate limiter middleware tests

**Current Status**: 153/153 tests passing (100%)

## Database

### Schema Overview

- `members` - User accounts and profiles
- `submissions` - Breeding achievement records
- `species_name` - Species catalog with classifications
- `tank_presets` - User-saved tank configurations
- `awards` - Award definitions and point thresholds
- `sessions` - Cookie-based session storage
- `activity_feed` - Activity log for member dashboard

### Migrations

Migrations run automatically on startup. To create a new migration:

```bash
# Create migration file in db/migrations/
# Format: YYYY-description.sql
```

## Deployment

### Production Environment

The application runs on AWS EC2 with the following components:

- **EC2 Instance**: t3.micro (1 vCPU, 1GB RAM)
- **Data Volume**: 8GB EBS volume (persistent across deployments)
- **Elastic IP**: 98.91.62.199 (pinned, never changes)
- **SSL**: Let's Encrypt via Certbot
- **Containers**: Docker Compose with nginx, app, and certbot

### Deploying Updates

```bash
# Deploy latest code from main branch
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml up -d --build"

# View logs
ssh BAP "sudo docker logs basny-app --tail 50"

# Restart containers
ssh BAP "cd /opt/basny && sudo docker-compose -f docker-compose.prod.yml restart"
```

### Infrastructure Management

Infrastructure is managed with AWS CDK:

```bash
cd infrastructure
npm run cdk deploy  # Deploy infrastructure changes
npm run cdk diff    # Preview changes
```

**Critical Resources** (never delete):
- EBS Volume: `vol-0aba5b85a1582b2c0` (contains database and config)
- Elastic IP: `eipalloc-01f29c26363e0465a` (DNS points here)

See `infrastructure/CRITICAL_RESOURCES.md` for recovery procedures.

## Configuration Management

### Development
- Config file: `src/config.json` (git-ignored)
- Contains database path, OAuth credentials, SMTP settings, R2 storage keys

### Production
- Config file: `/mnt/basny-data/app/config/config.production.json`
- Mounted read-only into container at `/app/src/config.json`
- Permissions: Must be 600 (owner-only) and owned by UID 1001 (nodejs user)

## API Documentation

The application uses RESTful conventions:

### Submission Routes
- `GET /submissions/:id` - View submission details
- `POST /submissions` - Create new submission
- `PATCH /submissions/:id` - Update submission
- `DELETE /submissions/:id` - Delete submission

### Admin Routes
- `GET /admin/queue` - Approval queue
- `GET /admin/witness-queue` - Witness verification queue
- `POST /admin/submissions/:id/approve` - Approve submission
- `POST /admin/submissions/:id/deny` - Deny submission

See `CLAUDE.md` for complete route documentation.

## Contributing

### Code Style
- TypeScript with strict type checking
- ESLint for code quality
- Prettier for formatting (via ESLint)
- Pug templates with specific Tailwind conventions

### Pull Request Process
1. Create a feature branch from `main`
2. Make your changes with tests
3. Run `npm run lint` and `npm test`
4. Push and create a pull request
5. CI will automatically run tests and linting

### Pug Template Guidelines

**Critical Rules:**
- Use double quotes for attributes
- Break long Tailwind class chains across lines
- Use class attribute for modifiers (hover:, md:, focus:)
- Simple utilities only with dot notation

See `CLAUDE.md` for detailed Pug best practices.

## License

[Add your license here]

## Support

For issues or questions, please open an issue on GitHub.
