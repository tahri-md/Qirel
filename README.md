# Qirel - GraphQL API Gateway

A robust GraphQL API Gateway that provides federation capabilities, intelligent request routing, JWT authentication, and resilient subgraph communication.

## Overview

Qirel is a Node.js-based GraphQL gateway that acts as a unified entry point for multiple GraphQL microservices (subgraphs). It handles:

- **Query Planning**: Parses GraphQL queries and routes them to appropriate services
- **Authentication**: JWT-based token validation with role-based permissions
- **Resilience**: Retry logic with exponential backoff and request timeouts
- **Subgraph Routing**: Intelligent routing to backend services based on field queries
- **Request Aggregation**: Combines results from multiple services into a single response
- **Distributed Tracing**: Trace IDs for request tracking across services

## Architecture

```
User Request
    ↓
JWT Authentication & Validation
    ↓
Query Planning (Route to services)
    ↓
Execute Plan (with retries & timeouts)
    ↓
Aggregate Results
    ↓
Response
```

## Project Structure

```
src/
├── core/
│   ├── executor/          # Execution engine (future)
│   ├── gateway/
│   │   └── requestHandler.ts      # Main request processing logic
│   └── planner/
│       └── QueryPlanner.ts         # Query parsing & routing
├── configs/
│   └── env.ts                      # Environment configuration with Zod
├── graphql/
│   ├── TypDefs.ts                 # GraphQL schema definitions
│   └── resolvers.ts               # GraphQL resolvers
├── models/
│   └── gateway.ts                 # TypeScript interfaces
├── services/                       # Microservice implementations (future)
│   ├── users/
│   └── orders/
├── server.ts                       # Express & Apollo setup
└── index.ts                        # Entry point
```

## Features Implemented

### 1. Request Handler (`src/core/gateway/requestHandler.ts`)

- **Request Validation**: Ensures query and required fields are present
- **JWT Authentication**: Validates tokens and extracts user info & permissions
- **Query Planning**: Leverages QueryPlanner to determine execution steps
- **Retry Logic**: Implements exponential backoff (100ms, 200ms, 400ms, ...)
- **Timeout Handling**: Request-level timeouts to prevent hanging requests
- **Error Aggregation**: Collects errors while continuing to process other steps
- **Response Generation**: Returns aggregated data with metadata (duration, traceId, etc.)

### 2. Query Planner (`src/core/planner/QueryPlanner.ts`)

- **Query Parsing**: Uses `graphql-core` to parse incoming queries
- **Field-to-Service Mapping**: Routes fields to appropriate microservices
  - `user` → users service
  - `orders` → orders service
  - `product` → products service
- **Execution Plan**: Generates step-by-step execution plan for subgraph calls

### 3. Environment Configuration (`src/configs/env.ts`)

- **Zod Validation**: Runtime validation of environment variables
- **Service URLs**: Configurable endpoints for all microservices
- **Security**: Required SECRET_KEY for JWT validation
- **Request Settings**: Configurable timeouts and retry counts

### 4. GraphQL Integration (`src/graphql/`)

- **Apollo Server**: GraphQL server setup with Express middleware
- **Resolvers**: Gateway resolver connected to RequestHandler
- **Scalability**: Ready for schema federation (Apollo Federation v2)

### 5. Subgraph Communication

```typescript
callSubgraph()
├── Service URL Resolution (from env)
├── GraphQL Query Building
├── HTTP POST to subgraph
├── Token Forwarding
├── Distributed Tracing (X-Trace-ID)
└── Response Aggregation
```

## Configuration

### Environment Variables (`.env`)

```env
# Server
PORT=4000

# Request handling
REQUEST_TIMEOUT_MS=5000
RETRY_COUNT=3

# Security
SECRET_KEY=your-secret-key-here

# Microservices
USERS_SERVICE_URL=http://localhost:4001
ORDERS_SERVICE_URL=http://localhost:4002
PRODUCTS_SERVICE_URL=http://localhost:4003
```

## API Usage

### Gateway Endpoint

**POST** `/graphql`

```graphql
query GetUserOrders {
  user {
    id
    name
  }
  orders {
    id
    total
  }
}
```

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Response:**
```json
{
  "data": {
    "user": { "id": "1", "name": "John" },
    "orders": [{ "id": "101", "total": 99.99 }]
  },
  "extensions": {
    "duration": 245,
    "subgraphCalls": 2,
    "cacheHit": false,
    "traceId": "trace-1712800000000-abc123"
  }
}
```

## Installation & Running

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

## Dependencies

- **apollo-server**: GraphQL server
- **graphql**: GraphQL parsing & validation
- **jsonwebtoken**: JWT authentication
- **zod**: Runtime type validation
- **express**: HTTP framework
- **cors**: CORS support

## Future Enhancements

- [ ] Service Registry (dynamic service discovery)
- [ ] Query Caching (Redis integration)
- [ ] Rate Limiting & throttling
- [ ] Batch Processing (DataLoader)
- [ ] Apollo Federation v2 support
- [ ] GraphQL Subscriptions (WebSocket)
- [ ] Metrics & Monitoring (Prometheus)
- [ ] Advanced Authorization (Field-level)
- [ ] Query Complexity Analysis
- [ ] Persistent query storage

## Error Handling

- **Validation Errors**: Returned in response errors array
- **Auth Errors**: 401 Unauthorized
- **Service Errors**: Partial success with error details
- **Timeout Errors**: Captured and reported with retry information
- **Network Errors**: Automatic retry with exponential backoff

## Development Notes

### TypeScript Configuration

- Strict mode enabled
- `verbatimModuleSyntax` for proper module handling
- ES modules with `.js` extensions

### JWT Validation

Currently requires `SECRET_KEY` environment variable at startup. Token payload must contain:
```json
{
  "userId": "string",
  "permissions": ["string"]
}
```

## TODO

- [ ] Implement real subgraph communication
- [ ] Add rate limiting
- [ ] Implement query complexity analysis
- [ ] Add monitoring/observability
- [ ] Create integration tests
- [ ] Document API schema
- [ ] Setup CI/CD pipeline

---

**Author**: Tahri
**Created**: April 2026
**Status**: MVP - Core functionality implemented
