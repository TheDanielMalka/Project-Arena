import type { ApiFriendRow, ApiFriendRequestRow } from "@/lib/engine-api";

/** In-memory friend graph for Vitest `engine-api` mocks + `fetchSocialFromServer` hydration */
export const friendApiFixture = {
  friends: [] as ApiFriendRow[],
  incoming: [] as ApiFriendRequestRow[],
  outgoing: [] as ApiFriendRequestRow[],
  reset() {
    this.friends = [];
    this.incoming = [];
    this.outgoing = [];
  },
};
