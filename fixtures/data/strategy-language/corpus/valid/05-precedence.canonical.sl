version v1

if has_last_change() or has_competitor_ahead() and not has_competitor_behind() == true then
    return stay
end

if my_price_in_cents() - floor_in_cents() * 2 + 10 / 4 >= 0 then
    return cut::proportional
end

return stay
