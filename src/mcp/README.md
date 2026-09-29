# Mulm MCP Servers

Model Context Protocol (MCP) servers for managing Mulm's species and member databases.

MCP servers are available via two transport methods:
- **Stdio**: For local CLI usage (via `npm run mcp:species` or `npm run mcp:members`)
- **HTTP/SSE**: For remote access via HTTP endpoints (bearer token required off loopback; `fly proxy` for production)

## Available Servers

### 1. Species Database Server

Provides tools and resources for managing species data. Every tool is an
adapter over the Species catalogue (`src/species/`, `@/species`), so it obeys
the same rules as the admin UI: a Point class is 5, 10, 15 or 20; a rename
keeps the old Canonical name as a scientific Name; a merge keeps the loser's
Canonical name; a Species that Submissions reference cannot be deleted.

**Tools:**
- `create_species_group` - Create a Species
- `update_species_group` - Update Program class, Point class, CARES flag, references and images
- `delete_species_group` - Delete a Species (refused while any Submission references it)
- `add_species_name` - Add a Name (`kind`: `common` | `scientific`)
- `update_species_name` - Correct a Name's text in place
- `remove_species_name` - Remove a Name
- `find_names_by_text` - Find every Name with a given text, across Species
- `bulk_remove_names` - Remove Names of one kind by text or ids (with preview)
- `merge_species_groups` - Merge duplicate Species (with preview)
- `search_species` - Search with filters
- `get_species_detail` - Get full Species details
- `set_base_points` - Set the Point class (5, 10, 15 or 20)
- `toggle_cares_status` - Mark CARES species
- `update_canonical_name` - Rename the Canonical name

**Resources:**
- `species://groups/list` - All species
- `species://groups/{group_id}` - One Species with its Names by kind
- `species://groups/by-type/{Fish|Plant|Invert|Coral}` - Species by type
- `species://groups/by-class/{program class}` - Species by Program class
- `species://groups/cares` - CARES species
- `species://names/by-group/{group_id}` - A Species' Names by kind
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

### HTTP Transport (Remote Access)

The MCP HTTP server starts with the application when enabled in `config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "port": 3001,
    "host": "127.0.0.1",
    "token": "<long random string>"
  }
}
```

The tools can delete members and grant admin, so auth is enforced at startup:

- `host` on loopback (`127.0.0.1`, `localhost`, `::1`): `token` is optional. This is the local dev setup `.mcp.json` points at.
- Any other `host` (production binds `0.0.0.0` so `fly proxy` can reach it): `token` is required, at least 16 characters, or the MCP server refuses to start. The web app keeps running either way.

Clients send the token as `Authorization: Bearer <token>`. Generate one with `openssl rand -hex 32` and put it in the `CONFIG_JSON` Fly secret.

#### Accessing Production MCP via `fly proxy`

1. Forward a local port to the prod machine over Fly's WireGuard network. Use a port other than 3001 if a local dev server is running:
```bash
fly proxy 13001:3001 -a basny-bap
```
Prod scales to zero; `fly proxy` does not wake the machine, so load the site first if it is asleep.

2. Register the servers with Claude Code for this session's user, with the token in a header:
```bash
claude mcp add --transport http mulm-species-prod http://localhost:13001/mcp/species \
  --header "Authorization: Bearer $MULM_MCP_TOKEN"
claude mcp add --transport http mulm-backfill-prod http://localhost:13001/mcp/backfill \
  --header "Authorization: Bearer $MULM_MCP_TOKEN"
```
Endpoints: `/mcp/species`, `/mcp/members`, `/mcp/backfill`.

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
