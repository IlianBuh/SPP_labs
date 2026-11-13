import gql from 'graphql-tag';

const federation = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])`;
export const catalogTypeDefs = gql`${federation}
  enum EntryKind { BOOK COUNTRY PRODUCT }
  enum SortField { TITLE YEAR VALUE UPDATED_AT }
  enum SortDirection { ASC DESC }
  type Author { name: String! }
  type Source { id: ID! name: String! url: String! count: Int! }
  type BookDetails { editionCount: Int languages: [String!]! }
  type CountryDetails { capital: [String!]! region: String population: Float area: Float languages: [String!]! }
  type ProductDetails { brand: String price: Float rating: Float stock: Int }
  type Entry @key(fields: "id") {
    id: ID! title: String! kind: EntryKind! description: String! url: String!
    year: Int value: Float tags: [String!]! authors: [Author!]! source: Source!
    book: BookDetails country: CountryDetails product: ProductDetails updatedAt: String!
  }
  input EntryFilter { search: String kind: EntryKind sourceId: ID minYear: Int maxYear: Int tag: String minValue: Float maxValue: Float }
  input EntrySort { field: SortField = TITLE direction: SortDirection = ASC }
  type PageInfo { page: Int! pageSize: Int! totalPages: Int! hasNextPage: Boolean! }
  type EntryPage { items: [Entry!]! total: Int! pageInfo: PageInfo! }
  type KindCount { kind: EntryKind! count: Int! }
  type CatalogStats { total: Int! kinds: [KindCount!]! sources: [Source!]! }
  type Query {
    entries(filter: EntryFilter, sort: EntrySort, page: Int = 1, pageSize: Int = 20): EntryPage!
    entry(id: ID!): Entry
    catalogStats: CatalogStats!
    sources: [Source!]!
  }
`;
export const workspaceTypeDefs = gql`${federation}
  type Entry @key(fields: "id") { id: ID! notes(limit: Int = 20): [Note!]! noteCount: Int! }
  type Note { id: ID! text: String! createdAt: String! entry: Entry! }
  type Collection { id: ID! name: String! createdAt: String! items(limit: Int = 100): [Entry!]! }
  type ImportProgress { sourceId: String! fetched: Int! page: Int! done: Boolean! error: String }
  type ImportJob { id: ID! status: String! target: Int! createdAt: String! updatedAt: String! error: String progress: [ImportProgress!]! }
  type ServiceStatus { name: String! status: String! lastSeen: String requests: Int! errors: Int! rejected: Int! rateLimited: Int! overloaded: Int! inflight: Int! }
  type Span { id: ID! traceId: String! parentId: String service: String! operation: String! durationMs: Float! errors: Int! status: Int code: String at: String! }
  type Diagnostics { services: [ServiceStatus!]! requests: Int! errors: Int! rejected: Int! rateLimited: Int! overloaded: Int! p95Ms: Float! uptimeSeconds: Float! spans: [Span!]! }
  type Query { collections(limit: Int = 100, offset: Int = 0): [Collection!]! collectionCount: Int! collection(id: ID!): Collection importJobs: [ImportJob!]! diagnostics(traceId: String): Diagnostics! }
  type Mutation {
    createCollection(name: String!): Collection!
    renameCollection(id: ID!, name: String!): Collection!
    deleteCollection(id: ID!): Boolean!
    addToCollection(collectionId: ID!, entryId: ID!): Collection!
    removeFromCollection(collectionId: ID!, entryId: ID!): Collection!
    addNote(entryId: ID!, text: String!): Note!
    deleteNote(id: ID!): Boolean!
    startImport(target: Int = 10500): ImportJob!
    cancelImport(id: ID!): ImportJob!
  }
`;
