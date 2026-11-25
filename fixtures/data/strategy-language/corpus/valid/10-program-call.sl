version v1

const fast_cooldown_in_seconds = 600

if competitors_in_reach() >= 5 then
    return fn::standard(hike_cooldown_in_seconds = fast_cooldown_in_seconds)
end

return fn::standard()
