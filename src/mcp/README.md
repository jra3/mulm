# Mulm MCP Servers

Model Context Protocol (MCP) servers for managing Mulm's species and member databases.

MCP servers are available via two transport methods:
- **Stdio**: For local CLI usage (via `npm run mcp:species` or `npm run mcp:members`)
- **HTTP/SSE**: For remote access via HTTP endpoints (requires SSH tunnel for production)

## Available Servers

### 1. Species Database Server

Provides tools and resources for managing species data.

**Tools:**
- `create_species_group` - Create new species
- `update_species_group` - Update species metadata
- `delete_species_group` - Delete species (with safety checks)
- `add_species_synonym` - Add name variants
- `update_species_synonym` - Update name variants
- `delete_species_synonym` - Remove name variants
- `merge_species_groups` - Merge duplicate species
- `search_species` - Search with filters
- `get_species_detail` - Get full species details
- `set_base_points` - Update point values
- `toggle_cares_status` - Mark CARES species
- `update_canonical_name` - Update taxonomic names

**Resources:**
- `species://groups/list` - All species
- `species://groups/by-type/{Fish|Plant|Invert|Coral}` - Species by type
- `species://groups/cares` - CARES species
- `species://statistics` - Database statistics

### 2. Member Management Server

Provides tools and resources for managing member accounts.

**Tools:**
- `list_members` - Search and filter members
- `get_member_detail` - Get comprehensive member info
- `merge_members` - Merge duplicate accounts
- `update_member` - Update email/display name
- `delete_member` - Delete member (with safety checks)
- `set_admin_status` - Grant/revoke admin privileges

**Resources:**
- `members://list` - All members
- `members://admins` - Admin members only
- `members://{id}` - Individual member details
- `members://statistics` - Database statistics

## Configuration

### HTTP/SSE Transport (Remote Access)

The MCP HTTP server is available when the application is running and can be configured in `config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "port": 3001,
    "host": "127.0.0.1"
  }
}
```

**Important**: In production, the MCP port is bound to `127.0.0.1` only, requiring SSH tunnel access for security.

#### Accessing Production MCP via SSH Tunnel

1. Create an SSH tunnel to the production server:
```bash
ssh -L 3001:localhost:3001 BAP
```

2. Keep the SSH connection open and connect to `http://localhost:3001/mcp/species` or `http://localhost:3001/mcp/members`

#### MCP Client Configuration (via SSH Tunnel)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "mulm-species-prod": {
      "url": "http://localhost:3001/mcp/species",
      "transport": "sse"
    },
    "mulm-members-prod": {
      "url": "http://localhost:3001/mcp/members",
      "transport": "sse"
    }
  }
}
```

### Stdio Transport (Local Development)

For local development, use the stdio transport:

#### For Claude Code

Add to your Claude Code MCP settings (`.config/claude-code/mcp_settings.json` or via UI):

```json
{
  "mcpServers": {
    "mulm-species": {
      "command": "npm",
      "args": ["run", "mcp:species"],
      "cwd": "/Users/john/mulm"
    },
    "mulm-members": {
      "command": "npm",
      "args": ["run", "mcp:members"],
      "cwd": "/Users/john/mulm"
    }
  }
}
```

#### For Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mulm-species": {
      "command": "npm",
      "args": ["run", "mcp:species"],
      "cwd": "/Users/john/mulm"
    },
    "mulm-members": {
      "command": "npm",
      "args": ["run", "mcp:members"],
      "cwd": "/Users/john/mulm"
    }
  }
}
```

## Usage Examples

### Species Management

```
# Search for species
Use the search_species tool with query="Betta"

# Get species details
Use get_species_detail with group_id=123

# Merge duplicate species
Use merge_species_groups with canonical_group_id=100, defunct_group_id=150
# Use preview=true to see what will happen before executing
```

### Member Management

```
# Search for members
Use list_members with query="John"

# Get member details
Use get_member_detail with member_id=7

# Merge duplicate accounts (like we just did!)
Use merge_members with from_member_id=7, to_member_id=15, preview=true
# Remove preview=true to execute the merge

# Make someone an admin
Use set_admin_status with member_id=5, is_admin=true
```

## Development

### Running Manually

```bash
# Species server
npm run mcp:species

# Member server
npm run mcp:members
```

### Testing with MCP Inspector

```bash
# Install MCP inspector
npx @modelcontextprotocol/inspector npm run mcp:members
```

## Safety Features

Both servers include:
- **Transaction support** - All modifications are atomic
- **Preview mode** - See changes before executing (merge operations)
- **Safety checks** - Prevent destructive operations without confirmation
- **Validation** - Input validation on all tools
- **Error handling** - Graceful error responses

## Database Access

Both servers use the same database connection as the main application:
- **Config**: `src/config.json`
- **Database**: Path specified in config (`databaseFile`)
- **Mode**: Servers can read/write to the database
- **Isolation**: Each tool call runs independently

## Notes

- The servers use the same database as the running application
- Changes made via MCP are immediately visible in the web app
- Always test with `preview: true` for destructive operations
- Backup the database before major changes
