update byai.po_users_organization set position_id =1 where  position_id not in(select position_id from byai.po_position);
