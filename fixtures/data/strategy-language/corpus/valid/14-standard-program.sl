version v1

const hike_cooldown_in_seconds = 3600

# bez darmowych zmian nic nie robimy
if free_price_changes() == 0 then
    return stay
end

# walka o niższe miejsce albo zbyt świeża zmiana: tylko obniżka
if competitors_out_of_reach() > 0 or has_last_change() and since_last_change_in_seconds() < hike_cooldown_in_seconds then
    if free_price_changes() == 1 then
        return cut::minimal_undercut
    end
    return cut::proportional
end

# ostatnia darmowa zmiana: ostrożniejsze strategie
if free_price_changes() == 1 then
    return cut::minimal_undercut, hike::proportional_max_safe
end

return cut::proportional, hike::proportional
