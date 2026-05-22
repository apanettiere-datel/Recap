export interface Person {
  id: string;
  name: string;
  relationship: string;
  keywords: string[];
  phone: string | null;
  email: string | null;
  organization: string | null;
  notes: string;
  lastContactDate: string | null;
  createdAt: string;
}

export interface Commitment {
  id: string;
  noteId: string | null;
  personId: string | null;
  description: string;
  owner: 'me' | 'them';
  status: 'open' | 'completed' | 'overdue';
  dueDate: string | null;
  completedAt: string | null;
  addedToCalendar: boolean;
  createdAt: string;
  person?: Person;
}

export interface Topic {
  id: string;
  noteId: string;
  label: string;
}

export interface Quote {
  id: string;
  noteId: string;
  text: string;
  speaker: string;
  personId: string | null;
}

export interface Note {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  sentiment: string;
  audioUrl: string;
  duration: number;
  conversationMode: string;
  isProcessing: boolean;
  processingError: string | null;
  recordedAt: string;
  createdAt: string;
  commitments: Commitment[];
  topics: string[];
  people: Person[];
  quotes: Quote[];
  isPinned?: boolean;
  isArchived?: boolean;
}

export interface Insight {
  id: string;
  type: 'overdue_commitment' | 'dropped_thread' | 'recurring_topic' | 'relationship_decay' | 'sentiment_shift' | 'avoidance_pattern' | 'accountability';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  body: string;
  relatedPersonName: string | null;
  isRead: boolean;
  isDismissed: boolean;
  generatedAt: string;
}

export interface WeeklyReport {
  id: string;
  weekStarting: string;
  narrative: string;
  commitmentsMade: number;
  commitmentsCompleted: number;
  commitmentsOverdue: number;
  conversationCount: number;
  uniquePeopleCount: number;
  topTopics: string[];
  droppedThreads: string[];
  avoidedTopics: string[];
  suggestedFocus: string[];
  generatedAt: string;
}

export interface PersonListItem {
  id: string;
  name: string;
  relationship: string;
  totalConversations: number;
  openCommitments: number;
  lastContactDate: string | null;
}

export interface PersonDetail extends Omit<Person, 'notes'> {
  notes: Note[];
  commitments: Commitment[];
  insights: {
    frequentTopics: string[];
    dominantSentiment: string;
    avgDaysBetweenContacts: number;
    openCommitments: number;
  };
}

export interface ChatMessage {
  from: 'user' | 'ai';
  text: string;
  refs?: { noteId: string; label: string }[];
}

export interface SearchResults {
  notes: Note[];
  people: Person[];
  commitments: Commitment[];
}

export interface User {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  createdAt: string;
}
