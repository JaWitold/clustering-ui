version v1

if ((has_last_change()) or has_competitor_ahead()) and (has_competitor_behind()) then
    return stay
end

if (my_price_in_cents() - (floor_in_cents() - 10)) * (2 + 3) > (100) then
    return stay
end

if -(my_price_in_cents() + 1) < -(-floor_in_cents()) then
    return stay
end

if (has_last_change() == true) == (has_competitor_ahead() == false) then
    return stay
end

return stay
