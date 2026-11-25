version v1

const hours = 2
const cooldown_in_seconds = hours * 60 * 60
const min_ratio = 0.03
const night_mode = true

if night_mode and hour_of_day() < 6 then
    return stay
end

if has_last_change() and since_last_change_in_seconds() < cooldown_in_seconds then
    return cut::proportional
end

if has_mapped_margin() and mapped_margin_ratio() < min_ratio then
    return hike::max_safe
end

return cut::proportional, hike::proportional
