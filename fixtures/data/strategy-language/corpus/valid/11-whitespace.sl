version   v1
	if free_price_changes()==0
		then return stay
	end return cut::proportional	,	hike::proportional