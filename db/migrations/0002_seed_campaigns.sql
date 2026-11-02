-- P0 種子：兩則 Viduck 活動（draft，尚無素材；P1 上傳素材後再上線）
INSERT OR IGNORE INTO campaigns
  (id, advertiser_id, name, status, weight, revenue_type, revenue, currency, created_at, updated_at, created_by)
VALUES
  ('cp_viduck_javis', 'house', 'Viduck（javis 版位）', 'draft', 1, 'cpm', 30, 'TWD', 0, 0, 'seed'),
  ('cp_viduck_javid', 'house', 'Viduck（javid 版位）', 'draft', 1, 'cpm', 30, 'TWD', 0, 0, 'seed');

INSERT OR IGNORE INTO campaign_placements (campaign_id, placement_id, created_at) VALUES
  ('cp_viduck_javis', 'javis:watch-below', 0),
  ('cp_viduck_javid', 'javid:result-foot', 0);
