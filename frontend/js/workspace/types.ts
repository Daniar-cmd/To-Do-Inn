export type Id = number;

export type Flag = { id: Id; name: string; color: string; board_id?: Id };
export type Board = {
  id: Id;
  name: string;
  description: string;
  board_type: string;
  corporate_account_id: Id | null;
};
export type Task = {
  id: Id;
  list_id: Id;
  title: string;
  description: string;
  is_completed: boolean;
  is_important: boolean;
  urgency: number;
  due_date: string | null;
  deadline: string | null;
  location: string | null;
  scheduled_time: string | null;
  repeat_interval?: string | null;
  flag: Flag | null;
};
export type List = {
  id: Id;
  board_id: Id;
  name: string;
  description: string;
  created_at: string;
  due_date: string | null;
  is_important: boolean;
  is_pinned: boolean;
  sort_order: number;
  theme: string;
  flag: Flag | null;
};
export type Note = {
  id: Id;
  board_id: Id;
  title: string;
  body: string;
  annotation: string;
  created_at: string;
  is_important: boolean;
  is_pinned: boolean;
  sort_order: number;
  theme: string;
  image: { url: string; mime: string; offset: number } | null;
  flag: Flag | null;
};
export type Profile = {
  id: Id;
  username: string;
  email: string;
  secondary_email: string | null;
  account_type: string;
  about: string | null;
  github_url: string | null;
  telegram_url: string | null;
  preferred_theme: string;
  avatar: string | null;
};
export type ProfileDraft = {
  username: string; email: string; secondary_email: string; about: string; github_url: string; telegram_url: string; preferred_theme: string; avatar: string | null;
  current_password: string;
  new_password: string;
  confirm_password: string;
};
export type SearchResult = List & { board_name: string; tasks: Task[]; flags: Flag[] };
export type Notification = { id: Id; sender: string; message: string; created_at: string; is_read: boolean };
