version v1

if competitors_in_reach() > 0 then
    if cheapest_competitor_price_in_cents() < my_price_in_cents() then
        if free_price_changes() > 1 then
            return cut::bisection
        else
            return cut::minimal_undercut
        end
    elseif ceiling_in_cents() - my_price_in_cents() > 100 then
        return hike::max_safe
    end
    if hour_of_day() < 6 then
        return stay
    end
else
    return hike::proportional
end

return cut::proportional, hike::proportional
