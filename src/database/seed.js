/**
 * Seeds the database with the dataset the frontend previously hardcoded in
 * `src/utils/articlesStore.js` and `src/components/Discover/DiscoveryCards.jsx`,
 * plus the demo account from `src/utils/auth.js`.
 *
 * Running this makes the UI look identical to the localStorage build on a
 * fresh database, which is what makes the two versions comparable.
 *
 *   npm run seed            populate (idempotent)
 *   npm run seed:destroy    remove all seeded data
 */
import { ARTICLE_STATUS, ARTICLE_VISIBILITY, MEMBER_STATUS, TEAM_ROLE } from '../constants/index.js';
import { Article, ArticleView, Collection, RefreshToken, TeamMember, User } from '../models/index.js';
import { connectDatabase, disconnectDatabase, syncIndexes } from './connect.js';
import logger from '../utils/logger.js';
import { buildExcerpt, calculateReadTime, countWords } from '../utils/readTime.js';
import { slugify } from '../utils/slugify.js';

/** Matches DEMO_CREDENTIALS in the frontend's utils/auth.js. */
const DEMO_USER = {
  name: 'Alex Rivera',
  username: 'alexrivera',
  email: 'alex@inkflow.ai',
  password: 'demo1234',
  role: 'Editorial Lead',
  bio: 'Editorial lead exploring the intersection of AI and long-form writing.',
  country: 'United States',
  isEmailVerified: true,
};

/** The profile the frontend's profileStore defaulted to. */
const SECOND_USER = {
  name: 'Sulaima Khalil',
  username: 'sulaima',
  email: 'sulaima@example.com',
  password: 'demo1234',
  role: 'Web Developer & Data Analyst',
  country: 'Pakistan',
  isEmailVerified: true,
};

/** Wraps seed prose in the HTML the TipTap editor produces. */
const body = (paragraphs) => paragraphs.map((text) => `<p>${text}</p>`).join('');

/**
 * The union of the frontend's two seed sets. `discover` marks the items that
 * came from the Discover page, and also assigns them to the second demo
 * account so neither account is left empty.
 */
const ARTICLES = [
  {
    title: 'How Generative AI Is Reshaping the Future of Creative Work',
    excerpt: 'Generative AI is changing how creatives approach design, writing, and multimedia projects. Discover the opportunities and challenges it brings.',
    category: 'AI',
    tags: ['AI', 'Creativity', 'Future of Work'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-12-04',
    paragraphs: [
      'Generative models have moved from research demos to daily tools, and the creative industries are feeling the shift first. What began as novelty image generation now underpins storyboarding, copy drafting, and concept exploration at scale.',
      'The most effective teams treat these systems as collaborators rather than replacements. The model proposes; the practitioner selects, edits, and takes responsibility for the result. That division of labour is what separates useful output from generic filler.',
      'The open question is not whether the tools work, but which parts of the craft are worth automating. Speed is easy to measure. Taste is not, and taste is still what audiences respond to.',
    ],
  },
  {
    title: 'User Interviews: The Art of Asking Better Questions',
    excerpt: 'Conducting effective user interviews requires skill. Learn the key techniques to get actionable insights.',
    category: 'UX Research',
    tags: ['UX Research', 'Interviews', 'Product'],
    status: ARTICLE_STATUS.DRAFT,
    publishedAt: '2025-12-03',
    paragraphs: [
      'A bad interview question tells you what people think they should say. A good one surfaces what they actually did last Tuesday, and why.',
      'Anchor questions in concrete past behaviour rather than hypothetical futures. "Walk me through the last time you tried this" consistently outperforms "would you use a feature that…".',
      'Silence is the most underused technique in the researcher toolkit. The three seconds after an answer ends is where the qualification, the caveat, and the real story tend to arrive.',
    ],
  },
  {
    title: 'Design Systems: Why Every Brand Needs One',
    excerpt: 'A design system ensures consistency across products and teams. Learn how to build one that scales effectively.',
    category: 'Design',
    tags: ['Design Systems', 'Branding', 'Scale'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-11-30',
    discover: true,
    paragraphs: [
      'A design system is less a component library than a shared agreement about how decisions get made. The components are the artefact; the agreement is the value.',
      'Systems fail when they are treated as a one-off project rather than a product with users, a roadmap, and a maintainer. Adoption follows usefulness, and usefulness requires ongoing work.',
      'Start small and earn expansion. A well-documented button that everyone actually uses beats forty components nobody trusts.',
    ],
  },
  {
    title: 'Why UX Research Is the Foundation of Great Digital Products',
    excerpt: 'UX research uncovers user needs and behaviors. Discover methods to gather insights that drive product success.',
    category: 'UX Research',
    tags: ['UX Research', 'Strategy'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-12-01',
    discover: true,
    paragraphs: [
      'Research is not a phase that precedes design; it is the mechanism by which a team stays honest about who it is building for.',
      'The cheapest research is the research that prevents a quarter of wasted engineering. Five conversations before a decision routinely outperform a dashboard reviewed after it.',
      'Insight only counts once it changes something. A finding that does not alter a roadmap, a flow, or a priority was expensive entertainment.',
    ],
  },
  {
    title: 'Why Minimalism Still Dominates Digital Aesthetics',
    excerpt: 'Minimalism remains a key principle in modern design. Understand why simplicity improves user experience and engagement.',
    category: 'Design',
    tags: ['Design', 'Minimalism'],
    status: ARTICLE_STATUS.DRAFT,
    publishedAt: '2025-11-28',
    discover: true,
    paragraphs: [
      'Minimalism endures because attention is finite. Every element on a screen competes for a budget the user did not agree to spend.',
      'The discipline is subtractive: the work is deciding what to remove without removing meaning. Restraint reads as confidence.',
      'Where minimalism fails is when it strips affordances along with ornament. Clean should never mean unclear.',
    ],
  },
  {
    title: 'AI Agents: The Next Evolution Beyond Chatbots',
    excerpt: 'AI agents are taking automation to the next level. Learn how they can handle complex tasks and interact naturally with humans.',
    category: 'AI',
    tags: ['AI', 'Agents', 'Automation'],
    status: ARTICLE_STATUS.DRAFT,
    publishedAt: '2025-12-02',
    discover: true,
    paragraphs: [
      'A chatbot answers. An agent acts. The difference sounds semantic until something goes wrong and you need to know which system had authority to change state.',
      'Useful agents are defined as much by their constraints as their capabilities. Scope, permissions, and an audit trail are the features that make autonomy tolerable.',
      'The engineering challenge has shifted from generating plausible text to verifying consequential action.',
    ],
  },
  {
    title: 'Color Psychology: How Colors Influence Digital Behavior',
    excerpt: 'Colors impact emotions and decision-making. Explore how to use color effectively in your designs.',
    category: 'Design',
    tags: ['Design', 'Colour', 'Psychology'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-11-25',
    discover: true,
    paragraphs: [
      'Colour carries meaning before a single word is read, which makes it the fastest and least precise signal in an interface.',
      'Context beats convention. Red means danger on a form and celebration on a festival poster, and no palette guide overrides the situation the user is in.',
      'Accessibility is not a constraint on colour choice; it is the test of whether the choice communicated anything at all.',
    ],
  },
  {
    title: 'Breaking Down Distributed Systems for Beginners',
    excerpt: 'Distributed systems are the backbone of modern applications. Get a beginner-friendly introduction to key concepts.',
    category: 'Engineering',
    tags: ['Engineering', 'Distributed Systems'],
    status: ARTICLE_STATUS.DRAFT,
    publishedAt: '2025-12-04',
    discover: true,
    paragraphs: [
      'A distributed system is what you get the moment your program depends on something across a network it does not control.',
      'The hard parts are not the happy paths. Partial failure, message reordering, and clock disagreement are the everyday conditions, not the exceptions.',
      'Every consistency model is a trade you make on the user’s behalf. Choosing one without knowing the trade is how outages become surprises.',
    ],
  },
  {
    title: 'The Cognitive Biases That Impact User Decisions',
    excerpt: 'Understanding cognitive biases helps design better experiences. Learn which biases affect digital behavior.',
    category: 'Design',
    tags: ['Design', 'Psychology', 'Behaviour'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-11-27',
    discover: true,
    paragraphs: [
      'Users are not irrational; they are economising. Biases are shortcuts that usually work, which is precisely why they are so hard to design around.',
      'Anchoring, defaults, and loss aversion do most of the work in any pricing page ever built. Knowing that is a responsibility as much as a technique.',
      'The line between helping someone decide and manipulating them is drawn by whether the design serves the user’s goal or only the business’s.',
    ],
  },
  {
    title: 'The Future of Neural Prose: AI as an Editorial Partner',
    excerpt: 'How AI-assisted editing tools are becoming collaborators rather than replacements for professional writers.',
    category: 'Technology',
    tags: ['AI', 'Writing', 'Editorial'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-10-24',
    paragraphs: [
      'In the quiet intersection of human creativity and algorithmic precision, a new form of literature is beginning to emerge. This is not merely the automation of text, but the augmentation of thought.',
      'By leveraging transformer models tuned for high-precision editorial standards, writers are no longer constrained by the blank page. They operate in a collaborative feedback loop where intent is met with structural intelligence.',
      'As we look toward the horizon, the distinction between human-authored and machine-enhanced text will continue to blur. What remains constant is the writer’s judgment — the taste that decides which suggestions serve the work and which dilute it.',
    ],
  },
  {
    title: 'Quarterly Research on Quantum Computing Ethics',
    excerpt: 'An internal review of the ethical questions raised by recent advances in quantum computing research.',
    category: 'Ethics',
    tags: ['Ethics', 'Quantum', 'Research'],
    status: ARTICLE_STATUS.DRAFT,
    publishedAt: '2025-10-22',
    paragraphs: [
      'Quantum advances arrive with a familiar asymmetry: the capability is concentrated, and the consequences are distributed.',
      'Cryptographic obsolescence is the headline risk, but the governance questions around access and export control will bind sooner and harder.',
      'An ethics review that arrives after deployment is documentation, not governance.',
    ],
  },
  {
    title: 'Outdated Editorial Guidelines v1.0',
    excerpt: 'Legacy internal guidelines retained for historical reference only.',
    category: 'Internal',
    tags: ['Internal', 'Guidelines'],
    status: ARTICLE_STATUS.ARCHIVED,
    previousStatus: ARTICLE_STATUS.PUBLISHED,
    visibility: ARTICLE_VISIBILITY.PRIVATE,
    publishedAt: '2025-09-15',
    paragraphs: [
      'These guidelines predate the current editorial standard and are retained only so past decisions remain auditable.',
      'Refer to the current handbook for anything being written today.',
    ],
  },
  {
    title: 'Sustainable Deep Sea Exploration: A Technical Review',
    excerpt: 'Reviewing the engineering approaches that make long-duration deep sea research missions viable.',
    category: 'Science',
    tags: ['Science', 'Engineering', 'Sustainability'],
    status: ARTICLE_STATUS.PUBLISHED,
    publishedAt: '2025-10-18',
    paragraphs: [
      'Pressure, power, and communication are the three constraints that shape every deep sea platform ever built.',
      'Long-duration missions succeed on energy budgeting more than on propulsion. Endurance is a power management problem wearing a mechanical disguise.',
      'Sustainability at depth means leaving instrumentation that degrades safely, not merely instrumentation that survives.',
    ],
  },
];

/** Matches DEFAULT_TEAM in the frontend's teamStore.js. */
const TEAM = [
  { name: 'Marcus Thorne', email: 'marcus.thorne@inkflow.ai', role: TEAM_ROLE.ADMIN, joinedAt: '2024-01-15' },
  { name: 'Sarah Chen', email: 'sarah.chen@inkflow.ai', role: TEAM_ROLE.EDITOR, joinedAt: '2024-03-08' },
];

/** Matches the default collection in the frontend's collectionsStore.js. */
const COLLECTIONS = [
  { name: 'Design Inspiration', description: 'References worth revisiting before a new project.' },
];

/** Upserts a user, so re-running the seed never duplicates accounts. */
const upsertUser = async (definition) => {
  const existing = await User.findOne({ email: definition.email });
  if (existing) return existing;

  // Assigning the plaintext lets the model's pre-save hook hash it.
  return User.create(definition);
};

const seed = async () => {
  await connectDatabase();
  await syncIndexes();

  logger.info('Seeding InkFlow AI database…');

  const [owner, collaborator] = await Promise.all([
    upsertUser(DEMO_USER),
    upsertUser(SECOND_USER),
  ]);

  /* -- Articles ---------------------------------------------------------- */

  let createdArticles = 0;
  const articleIdsByTitle = new Map();

  for (const definition of ARTICLES) {
    // Alternate ownership so the second account is not empty.
    const author = definition.discover ? collaborator : owner;

    const existing = await Article.findOne({ title: definition.title, author: author._id });

    if (existing) {
      articleIdsByTitle.set(definition.title, existing._id);
      continue;
    }

    const content = body(definition.paragraphs);
    const publishedAt = new Date(`${definition.publishedAt}T09:00:00Z`);

    const article = await Article.create({
      title: definition.title,
      slug: slugify(definition.title),
      content,
      excerpt: definition.excerpt || buildExcerpt(content),
      category: definition.category,
      tags: definition.tags,
      author: author._id,
      // `authorName` is a cache of the owning account's name, not a free-text
      // byline: a rename rewrites it across every article. The fictional
      // names in the frontend's seed data are therefore not carried over.
      authorName: author.name,
      status: definition.status,
      previousStatus: definition.previousStatus,
      visibility: definition.visibility ?? ARTICLE_VISIBILITY.PUBLIC,
      readTime: calculateReadTime(content),
      wordCount: countWords(content),
      publishedAt: definition.status === ARTICLE_STATUS.PUBLISHED ? publishedAt : undefined,
      createdAt: publishedAt,
    });

    articleIdsByTitle.set(definition.title, article._id);
    createdArticles += 1;
  }

  /* -- Team -------------------------------------------------------------- */

  let createdMembers = 0;

  for (const member of TEAM) {
    const existing = await TeamMember.findOne({ workspaceOwner: owner._id, email: member.email });
    if (existing) continue;

    await TeamMember.create({
      workspaceOwner: owner._id,
      name: member.name,
      email: member.email,
      role: member.role,
      status: MEMBER_STATUS.ACTIVE,
      invitedBy: owner._id,
      joinedAt: new Date(`${member.joinedAt}T09:00:00Z`),
    });

    createdMembers += 1;
  }

  /* -- Collections and bookmarks ----------------------------------------- */

  let createdCollections = 0;

  // The frontend seeded "Design Inspiration" with two design articles and
  // bookmarked a further two; reproduce that shape against real ids.
  const designArticleIds = [
    articleIdsByTitle.get('Design Systems: Why Every Brand Needs One'),
    articleIdsByTitle.get('Why Minimalism Still Dominates Digital Aesthetics'),
  ].filter(Boolean);

  for (const definition of COLLECTIONS) {
    const existing = await Collection.findOne({ owner: owner._id, name: definition.name });
    if (existing) continue;

    await Collection.create({
      owner: owner._id,
      name: definition.name,
      description: definition.description,
      articles: designArticleIds,
    });

    createdCollections += 1;
  }

  const bookmarkIds = [
    articleIdsByTitle.get('Design Systems: Why Every Brand Needs One'),
    articleIdsByTitle.get('AI Agents: The Next Evolution Beyond Chatbots'),
    ...designArticleIds,
  ].filter(Boolean);

  if (bookmarkIds.length > 0) {
    await User.updateOne({ _id: owner._id }, { $addToSet: { bookmarks: { $each: bookmarkIds } } });
    await Article.updateMany({ _id: { $in: bookmarkIds } }, { $set: { bookmarkCount: 1 } });
  }

  logger.info(
    `Seed complete — users: 2, articles: +${createdArticles}, team: +${createdMembers}, collections: +${createdCollections}`,
  );
  logger.info(`Demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
};

/** Removes everything the seed creates. Destructive by design. */
const destroy = async () => {
  await connectDatabase();

  logger.warn('Removing all seeded data…');

  const users = await User.find({ email: { $in: [DEMO_USER.email, SECOND_USER.email] } }).select('_id');
  const userIds = users.map((user) => user._id);

  const [articles, collections, members, views, tokens, deletedUsers] = await Promise.all([
    Article.deleteMany({ author: { $in: userIds } }),
    Collection.deleteMany({ owner: { $in: userIds } }),
    TeamMember.deleteMany({ workspaceOwner: { $in: userIds } }),
    ArticleView.deleteMany({ author: { $in: userIds } }),
    RefreshToken.deleteMany({ user: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);

  logger.info(
    `Removed — users: ${deletedUsers.deletedCount}, articles: ${articles.deletedCount}, collections: ${collections.deletedCount}, team: ${members.deletedCount}, views: ${views.deletedCount}, tokens: ${tokens.deletedCount}`,
  );
};

const run = async () => {
  const shouldDestroy = process.argv.includes('--destroy');

  try {
    await (shouldDestroy ? destroy() : seed());
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    logger.error(`Seed failed: ${error.message}`);
    logger.debug(error.stack);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
};

run();
