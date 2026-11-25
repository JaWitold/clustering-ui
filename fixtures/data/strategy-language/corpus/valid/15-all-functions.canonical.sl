version v1

if my_price_in_cents() > floor_in_cents() and my_price_in_cents() < ceiling_in_cents() then
    return stay
end

if competitors_in_reach() > 0 and cheapest_competitor_price_in_cents() > 0 and competitors_out_of_reach() == 0 then
    return stay
end

if free_price_changes() > 0 and has_last_change() and since_last_change_in_seconds() > 0 then
    return stay
end

if hour_of_day() == 0 or day_of_week() == 7 then
    return stay
end

if has_competitor_ahead() and is_competitor_ahead_vat_seller() then
    return stay
end

if has_competitor_behind() and is_competitor_behind_vat_seller() then
    return stay
end

if has_mapped_margin() and mapped_margin_in_cents() > 0 and mapped_margin_ratio() > 0.0 then
    return stay
end

if has_real_margin() and real_margin_in_cents() > 0 and real_margin_ratio() > 0.0 then
    return stay
end

if my_price_changes_in_short_period() > 0 or competitor_price_changes_in_short_period() > 0 then
    return stay
end

if has_price_change_statistics() and my_average_daily_price_changes() > 0 and competitor_average_daily_price_changes() > 0 then
    return stay
end

return stay
