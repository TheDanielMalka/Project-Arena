import { create } from "zustand";
import type {
  ForumCategory,
  ForumThread,
  ForumPost,
  ForumThreadDetail,
} from "@/lib/engine-api";
import {
  apiGetForumCategories,
  apiGetForumThreads,
  apiGetForumThread,
  apiGetForumPosts,
  apiCreateForumPost,
  apiReactForumPost,
  apiPollForumThread,
  apiDeleteForumPost,
} from "@/lib/engine-api";

interface ForumState {
  categories: ForumCategory[];
  categoriesLoading: boolean;

  threads: ForumThread[];
  threadsLoading: boolean;
  threadsPage: number;
  threadsTotal: number;
  threadsPages: number;

  thread: ForumThreadDetail | null;
  threadLoading: boolean;

  posts: ForumPost[];
  postsLoading: boolean;
  postsPage: number;
  postsTotal: number;
  postsPages: number;

  // Actions
  loadCategories: () => Promise<void>;
  loadThreads: (categorySlug: string, page?: number) => Promise<void>;
  loadThread: (slug: string) => Promise<void>;
  loadPosts: (threadId: string, page?: number) => Promise<void>;
  submitPost: (token: string, threadId: string, body: string) => Promise<ForumPost | null>;
  reactPost: (token: string, postId: string, emoji: string) => Promise<void>;
  pollThread: (threadId: string) => Promise<void>;
  deletePost: (token: string, postId: string) => Promise<boolean>;
}

export const useForumStore = create<ForumState>((set, get) => ({
  categories: [],
  categoriesLoading: false,

  threads: [],
  threadsLoading: false,
  threadsPage: 1,
  threadsTotal: 0,
  threadsPages: 1,

  thread: null,
  threadLoading: false,

  posts: [],
  postsLoading: false,
  postsPage: 1,
  postsTotal: 0,
  postsPages: 1,

  loadCategories: async () => {
    set({ categoriesLoading: true });
    const cats = await apiGetForumCategories();
    set({ categories: cats ?? [], categoriesLoading: false });
  },

  loadThreads: async (categorySlug, page = 1) => {
    set({ threadsLoading: true });
    const data = await apiGetForumThreads(categorySlug, page);
    if (data) {
      set({
        threads: data.threads,
        threadsPage: page,
        threadsTotal: data.total,
        threadsPages: data.pages,
        threadsLoading: false,
      });
    } else {
      set({ threadsLoading: false });
    }
  },

  loadThread: async (slug) => {
    set({ threadLoading: true, thread: null, posts: [] });
    const t = await apiGetForumThread(slug);
    set({ thread: t, threadLoading: false });
  },

  loadPosts: async (threadId, page = 1) => {
    set({ postsLoading: true });
    const data = await apiGetForumPosts(threadId, page);
    if (data) {
      set({
        posts: page === 1 ? data.posts : [...get().posts, ...data.posts],
        postsPage: page,
        postsTotal: data.total,
        postsPages: data.pages,
        postsLoading: false,
      });
    } else {
      set({ postsLoading: false });
    }
  },

  submitPost: async (token, threadId, body) => {
    const result = await apiCreateForumPost(token, threadId, body);
    if (result.ok) {
      set((s) => ({ posts: [...s.posts, result.post] }));
      return result.post;
    }
    return null;
  },

  reactPost: async (token, postId, emoji) => {
    const reactions = await apiReactForumPost(token, postId, emoji);
    if (!reactions) return;
    set((s) => ({
      posts: s.posts.map((p) =>
        p.id === postId ? { ...p, reactions } : p,
      ),
    }));
  },

  pollThread: async (threadId) => {
    const { posts } = get();
    if (posts.length === 0) return;
    const lastId = posts[posts.length - 1].id;
    const data = await apiPollForumThread(threadId, lastId);
    if (data && data.posts.length > 0) {
      set((s) => ({ posts: [...s.posts, ...data.posts] }));
    }
  },

  deletePost: async (token, postId) => {
    const ok = await apiDeleteForumPost(token, postId);
    if (ok) {
      set((s) => ({
        posts: s.posts.map((p) =>
          p.id === postId ? { ...p, is_deleted: true, body: "[deleted]" } : p,
        ),
      }));
    }
    return ok;
  },
}));
