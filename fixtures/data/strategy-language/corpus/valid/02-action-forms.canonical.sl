version v1

if free_price_changes() == 0 then
    return stay
elseif free_price_changes() == 1 then
    return cut::minimal_undercut
elseif free_price_changes() == 2 then
    return hike::max_safe
end

return cut::proportional, hike::proportional
