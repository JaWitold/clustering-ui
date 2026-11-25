version v1

if not not has_last_change() then
    return stay
end

if not (has_last_change() or has_competitor_ahead()) then
    return stay
end

if (not has_last_change()) == has_competitor_ahead() then
    return stay
end

return stay
